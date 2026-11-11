import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpServer } from '@avijs/http';
import {
  Controller,
  Get,
  Injectable,
  Module,
  createAvi,
  createToken,
  defineController,
  defineFactory,
  defineModule,
  sse,
  type AviApp,
  type Context,
  type OnInit,
  type OnShutdown,
} from '../src/index.js';

let app: AviApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const silent = { logger: { error: () => undefined } };

describe('lifecycle hooks', () => {
  it('runs onInit before routes serve, and onShutdown while requests in flight finish', async () => {
    const log: string[] = [];
    let url = '';
    let release: () => void = () => undefined;

    @Injectable()
    class Queue implements OnInit, OnShutdown {
      ready = false;
      onInit() {
        this.ready = true;
        log.push('init');
      }
      async onShutdown() {
        // New connections are already refused; the request in flight is still running.
        const refused = await fetch(`${url}/ready`).then(
          () => false,
          () => true,
        );
        log.push(`shutdown (new connection refused: ${String(refused)})`);
        release();
      }
      [Symbol.dispose]() {
        log.push('dispose');
      }
    }

    @Controller('/')
    class QueueController {
      static inject = [Queue] as const;
      constructor(private readonly queue: Queue) {}
      @Get('/ready')
      ready() {
        return String(this.queue.ready);
      }
      @Get('/slow')
      async slow() {
        await new Promise<void>((resolve) => (release = resolve));
        log.push('slow request done');
        return 'done';
      }
    }

    @Module({ providers: [Queue], controllers: [QueueController] })
    class AppModule {}

    app = createAvi().register(AppModule);
    const { port } = await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${String(port)}`;
    expect(await (await fetch(`${url}/ready`)).text()).toBe('true');

    const slow = fetch(`${url}/slow`).then((res) => res.text());
    await new Promise((resolve) => setTimeout(resolve, 20));
    await app.close();
    app = undefined;
    expect(await slow).toBe('done');
    expect(log).toEqual([
      'init',
      'shutdown (new connection refused: true)',
      'slow request done',
      'dispose',
    ]);
  });

  it('gives the explicit API the same hooks through factory options', async () => {
    const log: string[] = [];
    const Queue = createToken<{ name: string }>('Queue');
    app = createAvi().register(
      defineModule({
        providers: [
          defineFactory({
            provide: Queue,
            useFactory: () => ({ name: 'jobs' }),
            onInit: (queue) => log.push(`init ${queue.name}`),
            onShutdown: (queue) => log.push(`shutdown ${queue.name}`),
          }),
        ],
      }),
    );
    await app.init();
    await app.close();
    app = undefined;
    expect(log).toEqual(['init jobs', 'shutdown jobs']);
  });

  it('fails startup when onInit throws', async () => {
    class Broken {
      onInit() {
        throw new Error('no database');
      }
    }
    const instance = createAvi(silent).register({ providers: [Broken] });
    await expect(instance.init()).rejects.toThrow(
      /^Broken in AnonymousModule\d* failed in onInit$/,
    );
    await instance.close();
  });

  it('stops started providers when startup fails after the hooks', async () => {
    const log: string[] = [];
    class Poller {
      onInit() {
        log.push('started');
      }
      onShutdown() {
        log.push('stopped');
      }
    }
    const one = defineController({ routes: [{ method: 'GET', path: '/x', handler: () => 1 }] });
    const two = defineController({ routes: [{ method: 'GET', path: '/x', handler: () => 2 }] });
    const instance = createAvi(silent).register({ providers: [Poller], controllers: [one, two] });
    await expect(instance.init()).rejects.toThrow('Duplicate route: GET /x');
    expect(log).toEqual(['started', 'stopped']);
  });

  it('lets a second close() wait for the first', async () => {
    const log: string[] = [];
    class Slow {
      async onShutdown() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        log.push('hook done');
      }
    }
    const instance = createAvi().register({ providers: [Slow] });
    await instance.listen(0, '127.0.0.1');
    await Promise.all([
      instance.close(),
      instance.close().then(() => log.push('second close resolved')),
    ]);
    expect(log).toEqual(['hook done', 'second close resolved']);
  });

  it('still closes and disposes when onShutdown throws, then reports it', async () => {
    const log: string[] = [];
    class Flaky {
      onShutdown() {
        throw new Error('flush failed');
      }
      [Symbol.dispose]() {
        log.push('disposed');
      }
    }
    const instance = createAvi().register({ providers: [Flaky] });
    const { port } = await instance.listen(0, '127.0.0.1');
    const error = await instance.close().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(log).toEqual(['disposed']);
    await expect(fetch(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow();
  });

  it('ends SSE streams on close instead of waiting for shutdownTimeout', async () => {
    const events = defineController({
      routes: [
        {
          method: 'GET',
          path: '/events',
          handler: (ctx: Context) =>
            sse(ctx, async function* () {
              yield 'hello';
              await new Promise(() => undefined);
            }),
        },
      ],
    });
    app = createAvi({ shutdownTimeout: 10_000 }).register({ controllers: [events] });
    const { port } = await app.listen(0, '127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${String(port)}/events`);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();

    const started = performance.now();
    await app.close();
    app = undefined;
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('waits for a startup in progress, then shuts it down', async () => {
    const log: string[] = [];
    class Database {
      async onInit() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        log.push('init');
      }
      onShutdown() {
        log.push('shutdown');
      }
      [Symbol.dispose]() {
        log.push('dispose');
      }
    }
    const instance = createAvi(silent).register({ providers: [Database] });
    const listening = instance.listen(0, '127.0.0.1');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await instance.close();
    await expect(listening).rejects.toThrow('The app was closed while starting');
    expect(log).toEqual(['init', 'shutdown', 'dispose']);
    expect(instance.routes()).toEqual([]);
  });

  it('rejects listen() only after a close during startup has shut down', async () => {
    const log: string[] = [];
    class Database {
      async onInit() {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      onShutdown() {
        log.push('shutdown');
      }
      [Symbol.dispose]() {
        log.push('dispose');
      }
    }
    const instance = createAvi(silent).register({ providers: [Database] });
    const listening = instance.listen(0, '127.0.0.1').catch(() => log.push('listen rejected'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Like a signal handler registered before listen(): nobody awaits this close().
    void instance.close();
    await listening;
    expect(log).toEqual(['shutdown', 'dispose', 'listen rejected']);
  });

  it('cannot start again once closed', async () => {
    const instance = createAvi(silent).register({ providers: [] });
    await instance.listen(0, '127.0.0.1');
    await instance.close();
    await expect(instance.listen(0, '127.0.0.1')).rejects.toThrow('The app is closed');
    const unused = createAvi(silent).register({ providers: [] });
    await unused.close();
    await expect(unused.init()).rejects.toThrow('The app is closed');
  });

  it('logs a dispose failure after a failed startup and throws the startup error', async () => {
    const errors: string[] = [];
    class Leaky {
      [Symbol.dispose]() {
        throw new Error('dispose failed');
      }
    }
    const duplicate = defineController({
      routes: [
        { method: 'GET', path: '/', handler: () => 'a' },
        { method: 'GET', path: '/', handler: () => 'b' },
      ],
    });
    const instance = createAvi({
      logger: { error: (message: string) => errors.push(message) },
    }).register({ providers: [Leaky], controllers: [duplicate] });
    await expect(instance.init()).rejects.not.toThrow('dispose failed');
    expect(errors).toContain('Cleanup after the failed startup also failed');
  });

  it('reports a server close failure after disposing providers', async () => {
    const log: string[] = [];
    class Db {
      [Symbol.dispose]() {
        log.push('disposed');
      }
    }
    const instance = createAvi(silent).register({ providers: [Db] });
    await instance.listen(0, '127.0.0.1');
    const close = vi
      .spyOn(HttpServer.prototype, 'close')
      .mockRejectedValueOnce(new Error('close failed'));
    try {
      await expect(instance.close()).rejects.toThrow('close failed');
    } finally {
      close.mockRestore();
    }
    expect(log).toEqual(['disposed']);
  });

  it('prints no startup failure for listen() on a closed app', async () => {
    const errors: string[] = [];
    const logger = { error: (message: string) => errors.push(message), info: () => undefined };
    const instance = createAvi({ logger, startupSummary: true }).register({ providers: [] });
    await instance.close();
    await expect(instance.listen(0, '127.0.0.1')).rejects.toThrow('The app is closed');
    expect(errors).toEqual([]);
  });

  it('closes cleanly while the server is still binding', async () => {
    const instance = createAvi(silent).register({ providers: [] });
    // localhost needs a lookup, so the bind is still pending when close() starts.
    const listening = instance.listen(0, 'localhost');
    await Promise.resolve();
    await instance.close();
    await listening.then(
      () => undefined,
      () => undefined,
    );
  });

  it("runs a shared instance's hooks and dispose once", async () => {
    const log: string[] = [];
    class Database {
      onInit() {
        log.push('init');
      }
      onShutdown() {
        log.push('shutdown');
      }
      [Symbol.dispose]() {
        log.push('dispose');
      }
    }
    const Alias = createToken<Database>('Alias');
    const instance = createAvi().register(
      defineModule({
        providers: [
          Database,
          defineFactory({ provide: Alias, inject: [Database], useFactory: (db) => db }),
        ],
      }),
    );
    await instance.init();
    await instance.close();
    expect(log).toEqual(['init', 'shutdown', 'dispose']);
  });

  it('ends a stream sent by the errorHandler on close', async () => {
    const broken = defineController({
      routes: [
        {
          method: 'GET',
          path: '/broken',
          handler: () => {
            throw new Error('no');
          },
        },
      ],
    });
    app = createAvi({
      shutdownTimeout: 10_000,
      logger: { error: () => undefined },
      errorHandler: (_error, ctx) =>
        sse(ctx, async function* () {
          yield 'sorry';
          await new Promise(() => undefined);
        }),
    }).register({ controllers: [broken] });
    const { port } = await app.listen(0, '127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${String(port)}/broken`);
    await (res.body as ReadableStream<Uint8Array>).getReader().read();
    const started = performance.now();
    await app.close();
    app = undefined;
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
