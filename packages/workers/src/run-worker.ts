import {
  createAvi,
  type AviApp,
  type AviOptions,
  type ModuleOptions,
  type ModuleRef,
} from '@avijs/core';
import { errorText, type WorkerLogger } from './log.js';

export interface RunWorkerOptions extends AviOptions {
  /** Default: console. */
  logger?: AviOptions['logger'] & WorkerLogger;
}

export type WorkFunction = (app: AviApp, signal: AbortSignal) => unknown;

/**
 * Runs `work` with the app's providers and no HTTP server: a job consumer, a scheduler or a
 * script. `signal` aborts on SIGINT or SIGTERM; the app is closed afterwards, providers in reverse
 * order. Sets `process.exitCode`: 0 on success or shutdown, 1 when startup or `work` fails.
 */
export async function runWorker(
  root: ModuleRef | ModuleOptions | AviApp,
  work: WorkFunction,
  options: RunWorkerOptions = {},
): Promise<void> {
  const logger: WorkerLogger = options.logger ?? console;
  const controller = new AbortController();
  let signals = 0;
  const onSignal = () => {
    // A second signal while closing means stop now.
    if (++signals > 1) process.exit(1);
    controller.abort(new Error('Worker shutting down'));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const app = isApp(root) ? root : createAvi(options).register(root);
  try {
    try {
      await app.init();
    } catch (error) {
      logger.error(`Worker failed to start: ${errorText(error)}`);
      process.exitCode = 1;
      return;
    }
    try {
      await work(app, controller.signal);
    } catch (error) {
      // Work that stops by throwing the abort reason has shut down as asked.
      if (controller.signal.aborted && isAbort(error, controller.signal)) return;
      logger.error(`Worker failed: ${errorText(error)}`, error);
      process.exitCode = 1;
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    try {
      await app.close();
    } catch (error) {
      logger.error(`Worker failed to close: ${errorText(error)}`, error);
      process.exitCode = 1;
    }
  }
}

function isApp(value: unknown): value is AviApp {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<AviApp>).init === 'function' &&
    typeof (value as Partial<AviApp>).register === 'function'
  );
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return error === signal.reason || (error instanceof Error && error.name === 'AbortError');
}
