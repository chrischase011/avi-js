import type { AviApp } from '@avijs/core';
import nodeCluster, { type Worker } from 'node:cluster';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { errorText, type WorkerLogger } from './log.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export interface ClusterOptions {
  /** Worker processes: a number, or `'auto'` for one per CPU core. Default: `'auto'`. */
  workers?: number | 'auto';
  /** How long workers get to finish in-flight requests on shutdown, in ms. Default: 10 000. */
  shutdownTimeout?: number;
  /** Stop restarting after this many unexpected exits within `restartWindow`. Default: 5. */
  maxRestarts?: number;
  /** In ms. Default: 10 000. */
  restartWindow?: number;
  /** Default: console. */
  logger?: WorkerLogger;
}

export interface ClusterHandle {
  /** Running workers; 1 when the app runs in this process. */
  readonly workers: number;
  /** Replaces the workers one at a time, starting each new one before stopping an old one. */
  restart(): Promise<void>;
  /** Asks every worker to close its app, waits up to `shutdownTimeout`, then stops them. */
  close(): Promise<void>;
  /** Settles once the cluster has stopped: after close(), or after too many crashes. */
  readonly closed: Promise<void>;
}

type Start = () => Promise<AviApp | undefined> | AviApp | undefined;

// Messages between the primary and the workers it forked.
type Message =
  | { readonly avi: 'ready' }
  | { readonly avi: 'failed'; readonly error: string }
  | { readonly avi: 'shutdown' }
  | { readonly avi: 'closed' };

const MARK = 'AVI_CLUSTER_WORKER';

function isMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { avi?: unknown }).avi === 'string'
  );
}

/**
 * Runs `start` in one worker process per CPU core, all sharing the port the app listens on. The
 * primary process only manages workers: it never calls `start`, so it opens no connections.
 * With one worker, or `NODE_ENV=development`, `start` runs in this process instead.
 */
export async function cluster(start: Start, options: ClusterOptions = {}): Promise<ClusterHandle> {
  const count = workerCount(options.workers ?? 'auto');
  const logger = options.logger ?? console;

  if (nodeCluster.isWorker && process.env[MARK]) return runAsWorker(start, logger);
  if (count === 1 || process.env['NODE_ENV'] === 'development') {
    return runInProcess(start, logger, options.shutdownTimeout ?? 10_000);
  }
  return runPrimary(count, options, logger);
}

function workerCount(workers: number | 'auto'): number {
  if (workers === 'auto') return availableParallelism();
  if (!Number.isInteger(workers) || workers < 1) {
    throw new RangeError(
      `cluster: workers must be a positive integer or 'auto', got ${String(workers)}`,
    );
  }
  return workers;
}

async function runAsWorker(start: Start, logger: WorkerLogger): Promise<ClusterHandle> {
  const send = (message: Message) => process.send?.(message);
  // The primary coordinates shutdown; a terminal's Ctrl+C reaches every process in the group.
  const ignore = () => undefined;
  process.on('SIGINT', ignore);
  process.on('SIGTERM', ignore);

  let app: AviApp | undefined;
  try {
    app = (await start()) ?? undefined;
  } catch (error) {
    send({ avi: 'failed', error: errorText(error) });
    process.exit(1);
  }

  const closed = settled();
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      try {
        await app?.close();
      } catch (error) {
        logger.error(`Worker ${String(process.pid)} failed to close`, error);
      }
      closed.resolve();
      if (!process.connected) process.exit(0);
      // Until the primary has seen the server close, it may still hand this worker connections,
      // which must be sent back rather than lost. It disconnects the worker once that is over.
      send({ avi: 'closed' });
    })());
  process.on('message', (message: unknown) => {
    if (isMessage(message) && message.avi === 'shutdown') void close();
  });
  process.once('disconnect', () => {
    // Exit as soon as nothing else keeps the process alive, or after a second regardless.
    setTimeout(() => process.exit(0), 1_000).unref();
    // The primary is gone without asking: nobody else will stop this worker.
    void close();
  });
  send({ avi: 'ready' });

  return {
    workers: 1,
    restart: () => Promise.reject(new Error('cluster: call restart() in the primary process')),
    close: () => close(),
    closed: closed.promise,
  };
}

async function runInProcess(
  start: Start,
  logger: WorkerLogger,
  shutdownTimeout: number,
): Promise<ClusterHandle> {
  let app = (await start()) ?? undefined;
  const closed = settled();
  const close = async () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    const closing = app?.close();
    app = undefined;
    await withTimeout(closing, shutdownTimeout);
    closed.resolve();
  };
  const onSignal = () => {
    close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error('Shutdown failed', error);
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return {
    workers: 1,
    restart: async () => {
      await app?.close();
      app = (await start()) ?? undefined;
    },
    close,
    closed: closed.promise,
  };
}

async function runPrimary(
  count: number,
  options: ClusterOptions,
  logger: WorkerLogger,
): Promise<ClusterHandle> {
  const shutdownTimeout = options.shutdownTimeout ?? 10_000;
  const maxRestarts = options.maxRestarts ?? 5;
  const restartWindow = options.restartWindow ?? 10_000;
  const began = performance.now();

  const running = new Set<Worker>();
  const leaving = new Set<Worker>();
  const exits: number[] = [];
  let stopping = false;
  let address: string | undefined;

  nodeCluster.on('listening', (_worker, info) => {
    address ??= urlOf(info);
  });

  /** Forks a worker and resolves once it is ready; rejects if it fails to start. */
  const fork = () =>
    new Promise<Worker>((resolve, reject) => {
      const worker = nodeCluster.fork({ [MARK]: '1' });
      running.add(worker);
      let ready = false;
      worker.on('message', (message: unknown) => {
        // The app's own code may use process.send too; only our messages count.
        if (!isMessage(message)) return;
        if (message.avi === 'ready') {
          ready = true;
          resolve(worker);
        } else if (message.avi === 'failed') {
          reject(new Error(message.error));
        } else if (message.avi === 'closed') {
          // Node stops routing to the worker, then lets it hand back connections in flight.
          worker.disconnect();
        }
      });
      worker.once('exit', (code, signal) => {
        running.delete(worker);
        if (!ready) {
          reject(new Error(`Worker exited during startup (${signal || `code ${String(code)}`})`));
          return;
        }
        if (stopping || leaving.delete(worker)) return;
        replace(signal || `code ${String(code)}`);
      });
    });

  const replace = (why: string) => {
    const now = performance.now();
    exits.push(now);
    while (exits.length > 0 && (exits[0] ?? now) < now - restartWindow) exits.shift();
    if (exits.length > maxRestarts) {
      logger.error(
        `Workers keep crashing (${String(exits.length)} exits in ${String(restartWindow)} ms, last ${why}); stopping`,
      );
      process.exitCode = 1;
      void handle.close();
      return;
    }
    logger.warn?.(`A worker exited unexpectedly (${why}); starting a new one`);
    fork().catch((error: unknown) => {
      logger.error('A replacement worker failed to start', error);
      // It counts as a crash, so a replacement that never starts ends in the crash-loop stop.
      replace('a replacement failed to start');
    });
  };

  const stop = async (workers: readonly Worker[]) => {
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise<void>((resolve) => {
            if (worker.isDead()) {
              resolve();
              return;
            }
            const timer = setTimeout(() => worker.process.kill(), shutdownTimeout);
            timer.unref();
            worker.once('exit', () => {
              clearTimeout(timer);
              resolve();
            });
            // A worker already on its way out cannot be told; the timer or its exit ends this.
            if (worker.isConnected()) {
              worker.send({ avi: 'shutdown' } satisfies Message, () => undefined);
            }
          }),
      ),
    );
  };

  let closing: Promise<void> | undefined;
  const closed = settled();
  const handle: ClusterHandle = {
    closed: closed.promise,
    get workers() {
      return running.size;
    },
    restart: async () => {
      for (const old of [...running]) {
        await fork();
        leaving.add(old);
        await stop([old]);
      }
    },
    close: () =>
      (closing ??= (async () => {
        stopping = true;
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        if (process.platform !== 'win32') process.off('SIGHUP', onReload);
        await stop([...running]);
        nodeCluster.removeAllListeners('listening');
        closed.resolve();
      })()),
  };

  const onSignal = () => void handle.close();
  const onReload = () => {
    handle.restart().catch((error: unknown) => {
      logger.error('Rolling restart failed', error);
    });
  };

  try {
    await Promise.all(Array.from({ length: count }, fork));
  } catch (error) {
    await handle.close();
    throw new Error(`Avi.js cluster failed to start: ${errorText(error)}`, { cause: error });
  }

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  if (process.platform !== 'win32') process.on('SIGHUP', onReload);

  const ms = performance.now() - began;
  const message = `Avi.js ${version} cluster: ${String(count)} workers${address ? ` on ${address}` : ''}, ready in ${String(Math.round(ms))} ms`;
  // A structured entry for a logger the app passed; console has info() too, but prints the fields.
  if (options.logger?.info) {
    options.logger.info(message, { workers: count, url: address, durationMs: ms });
  } else {
    console.log(message);
  }
  return handle;
}

function urlOf(info: {
  address: string | null;
  port: number;
  addressType: number | string;
}): string {
  const any = !info.address || info.address === '0.0.0.0' || info.address === '::';
  const host = any ? 'localhost' : info.address?.includes(':') ? `[${info.address}]` : info.address;
  return `http://${host ?? 'localhost'}:${String(info.port)}`;
}

function settled(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function withTimeout(promise: Promise<void> | undefined, ms: number): Promise<void> {
  if (!promise) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    promise,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
      timer.unref();
    }),
  ]);
  clearTimeout(timer);
}
