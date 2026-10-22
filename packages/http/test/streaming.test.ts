import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { reply, type RouteDefinition, type ServerOptions } from '../src/index.js';
import { deferred, startServer, type TestServer } from './helpers.js';

let current: TestServer | undefined;

async function start(routes: readonly RouteDefinition[], options: ServerOptions = {}) {
  current = await startServer(routes, options);
  return current;
}

afterEach(async () => {
  await current?.server.close();
  current = undefined;
});

const get = (path: string, handler: RouteDefinition['handler']): RouteDefinition => ({
  method: 'GET',
  path,
  handler,
});

describe('streamed responses', () => {
  it('pipes a Node Readable as chunked octet-stream', async () => {
    const { url } = await start([get('/', () => Readable.from(['a', 'b', 'c']))]);
    const res = await fetch(url);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('transfer-encoding')).toBe('chunked');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('abc');
  });

  it('pipes a web ReadableStream', async () => {
    const { url } = await start([
      get(
        '/',
        () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('hello '));
              controller.enqueue(new TextEncoder().encode('web'));
              controller.close();
            },
          }),
      ),
    ]);
    expect(await (await fetch(url)).text()).toBe('hello web');
  });

  it('honours reply status and headers around a stream', async () => {
    const { url } = await start([
      get('/', (ctx) => {
        ctx.setHeader('x-from-ctx', '1');
        return reply(Readable.from(['line 1\n', 'line 2\n']), {
          status: 206,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }),
    ]);
    const res = await fetch(url);
    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('x-from-ctx')).toBe('1');
    expect(await res.text()).toBe('line 1\nline 2\n');
  });

  it('sends a web Response with its status, headers and body', async () => {
    const { url } = await start([
      get('/', (ctx) => {
        ctx.setHeader('x-ctx', 'kept');
        ctx.setHeader('cache-control', 'no-store');
        return new Response('created', {
          status: 201,
          headers: { 'cache-control': 'max-age=5', 'x-response': 'yes' },
        });
      }),
      get('/empty', () => new Response(null, { status: 204 })),
    ]);
    const res = await fetch(url);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('text/plain;charset=UTF-8');
    expect(res.headers.get('cache-control')).toBe('max-age=5');
    expect(res.headers.get('x-ctx')).toBe('kept');
    expect(await res.text()).toBe('created');

    const empty = await fetch(`${url}/empty`);
    expect(empty.status).toBe(204);
    expect(await empty.text()).toBe('');
  });

  it('sends no body for HEAD and stops the source', async () => {
    let destroyed = false;
    const { url } = await start([
      get('/', () => {
        const source = Readable.from(['never sent']);
        source.on('close', () => {
          destroyed = true;
        });
        return source;
      }),
    ]);
    const res = await fetch(url, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(destroyed).toBe(true);
  });

  it('respects backpressure from a slow client', async () => {
    const chunk = Buffer.alloc(64 * 1024, 'x');
    let produced = 0;
    const total = 256 * 1024 * 1024;
    const { port } = await start([
      get(
        '/big',
        () =>
          new Readable({
            read() {
              if (produced >= total) {
                this.push(null);
                return;
              }
              produced += chunk.length;
              this.push(chunk);
            },
          }),
      ),
    ]);

    const paused = deferred<number>();
    const req = httpRequest({ port, host: '127.0.0.1', path: '/big' }, (res) => {
      res.pause();
      setTimeout(() => {
        paused.resolve(produced);
        res.destroy();
      }, 300);
    });
    req.on('error', () => undefined);
    req.end();

    // A client that never reads must not make the server read the whole source.
    expect(await paused.promise).toBeLessThan(64 * 1024 * 1024);
  });

  it('stops the source when the client disconnects, without logging', async () => {
    const closed = deferred();
    const { port, logger } = await start([
      get('/', () => {
        const source = new Readable({
          read() {
            setTimeout(() => this.push('tick\n'), 5);
          },
        });
        source.on('close', () => {
          closed.resolve();
        });
        return source;
      }),
    ]);
    const req = httpRequest({ port, host: '127.0.0.1', path: '/' }, (res) => {
      res.once('data', () => {
        req.destroy();
      });
    });
    req.on('error', () => undefined);
    req.end();
    await closed.promise;
    await new Promise((r) => setTimeout(r, 20));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a stream that fails after the response started', async () => {
    const { url, logger } = await start([
      get('/', () =>
        Readable.from(
          (async function* () {
            yield 'partial';
            await Promise.resolve();
            throw new Error('disk gone');
          })(),
        ),
      ),
    ]);
    await expect(fetch(url).then((res) => res.text())).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(logger.error).toHaveBeenCalledWith(
      'Response stream failed: GET /',
      expect.objectContaining({ message: 'disk gone' }),
    );
  });
});
