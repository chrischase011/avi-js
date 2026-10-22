import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError, HttpServer, Router, reply, type RouteDefinition } from '../src/index.js';
import { deferred, startServer, type TestServer } from './helpers.js';

let current: TestServer | undefined;

async function start(routes: readonly RouteDefinition[], options = {}) {
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
const post = (path: string, handler: RouteDefinition['handler']): RouteDefinition => ({
  method: 'POST',
  path,
  handler,
});

describe('responses', () => {
  it('sends objects as JSON', async () => {
    const { url } = await start([get('/', () => ({ hello: 'world' }))]);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('content-length')).toBe('17');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.json()).toEqual({ hello: 'world' });
  });

  it('sends strings as UTF-8 text', async () => {
    const { url } = await start([get('/', () => 'héllo')]);
    const res = await fetch(url);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-length')).toBe('6');
    expect(await res.text()).toBe('héllo');
  });

  it('sends bytes as octet-stream', async () => {
    const { url } = await start([get('/', () => new Uint8Array([1, 2, 3]))]);
    const res = await fetch(url);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each([
    [null, 'null'],
    [42, '42'],
    [false, 'false'],
    [[1, 2], '[1,2]'],
  ])('sends %j as JSON', async (value, expected) => {
    const { url } = await start([get('/', () => value)]);
    const res = await fetch(url);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.text()).toBe(expected);
  });

  it('sends 204 with no body for undefined', async () => {
    const { url } = await start([get('/', () => undefined)]);
    const res = await fetch(url);
    expect(res.status).toBe(204);
    expect(res.headers.get('content-type')).toBeNull();
    expect(await res.text()).toBe('');
  });

  it('awaits async handlers', async () => {
    const { url } = await start([
      get('/', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { async: true };
      }),
    ]);
    expect(await (await fetch(url)).json()).toEqual({ async: true });
  });

  it('applies reply status and headers', async () => {
    const { url } = await start([
      post('/users', () => reply({ id: 1 }, { status: 201, headers: { location: '/users/1' } })),
      get('/empty', () => reply(undefined, { status: 202 })),
      get('/html', () => reply('<p>hi</p>', { headers: { 'content-type': 'text/html' } })),
    ]);

    const created = await fetch(`${url}/users`, { method: 'POST' });
    expect(created.status).toBe(201);
    expect(created.headers.get('location')).toBe('/users/1');
    expect(await created.json()).toEqual({ id: 1 });

    const empty = await fetch(`${url}/empty`);
    expect(empty.status).toBe(202);
    expect(await empty.text()).toBe('');

    const html = await fetch(`${url}/html`);
    expect(html.headers.get('content-type')).toBe('text/html');
  });

  it('returns 404 JSON for unknown paths and methods', async () => {
    const { url, logger } = await start([get('/known', () => 'ok')]);

    for (const res of [
      await fetch(`${url}/missing`),
      await fetch(`${url}/known`, { method: 'DELETE' }),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Not Found',
      });
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('exposes path and query separately', async () => {
    const { url } = await start([
      get('/search', (ctx) => ({
        path: ctx.path,
        q: ctx.query.get('q'),
        tags: ctx.query.getAll('t'),
      })),
    ]);
    const res = await fetch(`${url}/search?q=avi&t=a&t=b`);
    expect(await res.json()).toEqual({ path: '/search', q: 'avi', tags: ['a', 'b'] });
  });
});

describe('errors', () => {
  it('hides thrown errors behind a generic 500 and logs them', async () => {
    const error = new Error('database password is hunter2');
    const { url, logger } = await start([
      get('/boom', () => {
        throw error;
      }),
    ]);

    const res = await fetch(`${url}/boom`);
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ statusCode: 500, error: 'Internal Server Error' });
    expect(body).not.toContain('hunter2');
    expect(logger.error).toHaveBeenCalledWith('Request failed: GET /boom', error);
  });

  it('handles rejected promises the same way', async () => {
    const { url, logger } = await start([
      get('/boom', () => Promise.reject(new Error('async secret'))),
    ]);
    const res = await fetch(`${url}/boom`);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('async secret');
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('sends 4xx HttpError messages without logging', async () => {
    const { url, logger } = await start([
      get('/bad', () => {
        throw new HttpError(422, 'Name is required');
      }),
    ]);
    const res = await fetch(`${url}/bad`);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Name is required',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps the status but hides the message of 5xx HttpErrors', async () => {
    const { url, logger } = await start([
      get('/down', () => {
        throw new HttpError(503, 'Replica db-3 is down');
      }),
    ]);
    const res = await fetch(`${url}/down`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ statusCode: 503, error: 'Service Unavailable' });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('turns serialization failures into a 500', async () => {
    const { url, logger } = await start([get('/', () => ({ big: 1n }))]);
    const res = await fetch(url);
    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('drops reply headers when writing them fails', async () => {
    const { url } = await start([
      get('/', () => reply('x', { headers: { 'x-first': 'kept?', 'x-bad': 'a\nb' } })),
    ]);
    const res = await fetch(url);
    expect(res.status).toBe(500);
    expect(res.headers.get('x-first')).toBeNull();
  });
});

describe('request body', () => {
  it('reads text', async () => {
    const { url } = await start([post('/', async (ctx) => (await ctx.text()).toUpperCase())]);
    const res = await fetch(url, { method: 'POST', body: 'hello' });
    expect(await res.text()).toBe('HELLO');
  });

  it('reads the body once and caches it', async () => {
    const { url } = await start([
      post('/', async (ctx) => [await ctx.text(), await ctx.text(), await ctx.json()]),
    ]);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    expect(await res.json()).toEqual(['{"a":1}', '{"a":1}', { a: 1 }]);
  });

  it.each(['application/json', 'application/json; charset=utf-8', 'application/problem+json'])(
    'parses JSON sent as %s',
    async (type) => {
      const { url } = await start([post('/', (ctx) => ctx.json())]);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': type },
        body: '[1]',
      });
      expect(await res.json()).toEqual([1]);
    },
  );

  it('rejects JSON with the wrong content type with 415', async () => {
    const { url } = await start([post('/', (ctx) => ctx.json())]);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(415);
  });

  it('rejects malformed JSON with 400', async () => {
    const { url, logger } = await start([post('/', (ctx) => ctx.json())]);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: 'Malformed JSON body' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('accepts a body exactly at the limit', async () => {
    const { url } = await start([post('/', (ctx) => ctx.text())], { bodyLimit: 5 });
    const res = await fetch(url, { method: 'POST', body: '12345' });
    expect(await res.text()).toBe('12345');
  });

  it('rejects a declared length over the limit with 413', async () => {
    let reached = false;
    const { url } = await start(
      [
        post('/', async (ctx) => {
          await ctx.text();
          reached = true;
        }),
      ],
      { bodyLimit: 10 },
    );
    const res = await fetch(url, { method: 'POST', body: 'x'.repeat(11) });
    expect(res.status).toBe(413);
    expect(res.headers.get('connection')).toBe('close');
    expect(reached).toBe(false);
  });

  it('rejects a streamed body over the limit with 413', async () => {
    const { port } = await start([post('/', (ctx) => ctx.text())], { bodyLimit: 10 });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest({ port, host: '127.0.0.1', method: 'POST', path: '/' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.write('x'.repeat(8));
      req.end('y'.repeat(8));
    });
    expect(status).toBe(413);
  });

  it('ignores the body when the handler does not read it', async () => {
    const { url } = await start([post('/', () => 'ignored')], { bodyLimit: 1 });
    const res = await fetch(url, { method: 'POST', body: 'x'.repeat(1000) });
    expect(res.status).toBe(200);
  });
});

describe('client disconnects', () => {
  it('aborts ctx.signal when the client goes away', async () => {
    const started = deferred();
    const aborted = deferred<boolean>();
    const { port } = await start([
      get('/slow', (ctx) => {
        ctx.signal.addEventListener('abort', () => {
          aborted.resolve(ctx.signal.aborted);
        });
        started.resolve();
        return new Promise(() => undefined);
      }),
    ]);

    const req = httpRequest({ port, host: '127.0.0.1', path: '/slow' });
    req.on('error', () => undefined);
    req.end();
    await started.promise;
    req.destroy();

    expect(await aborted.promise).toBe(true);
  });

  it('does not abort after a normal response', async () => {
    let signal: AbortSignal | undefined;
    const { url } = await start([
      get('/', (ctx) => {
        signal = ctx.signal;
        return 'ok';
      }),
    ]);
    await (await fetch(url)).text();
    expect(signal?.aborted).toBe(false);
  });
});

describe('lifecycle', () => {
  it('rejects a second listen', async () => {
    const { server } = await start([]);
    await expect(server.listen(0)).rejects.toThrow('already listening');
  });

  it('rejects when the port is taken, and can retry', async () => {
    const { port } = await start([]);
    const other = new HttpServer(new Router(), { logger: { error: () => undefined } });
    await expect(other.listen(port, '127.0.0.1')).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(other.listening).toBe(false);
    await other.listen(0, '127.0.0.1');
    await other.close();
  });

  it('resolves close() when not listening', async () => {
    await expect(new HttpServer(new Router()).close()).resolves.toBeUndefined();
  });

  it('lets in-flight requests finish before closing', async () => {
    const started = deferred();
    const release = deferred();
    const { url, server } = await start([
      get('/slow', async () => {
        started.resolve();
        await release.promise;
        return 'done';
      }),
    ]);

    const response = fetch(`${url}/slow`).then(async (res) => ({
      status: res.status,
      connection: res.headers.get('connection'),
      body: await res.text(),
    }));
    await started.promise;

    let closed = false;
    const closing = server.close().then(() => {
      closed = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(false);
    await expect(fetch(`${url}/slow`)).rejects.toThrow();

    release.resolve();
    expect(await response).toEqual({ status: 200, connection: 'close', body: 'done' });
    await closing;
    expect(server.listening).toBe(false);
  });

  it('closes idle keep-alive connections immediately', async () => {
    const { url, server } = await start([get('/', () => 'ok')], { shutdownTimeout: 60_000 });
    await (await fetch(url)).text();
    const begin = Date.now();
    await server.close();
    expect(Date.now() - begin).toBeLessThan(1000);
  });

  it('forces connections closed after shutdownTimeout', async () => {
    const started = deferred();
    const { url, server } = await start(
      [
        get('/hang', () => {
          started.resolve();
          return new Promise(() => undefined);
        }),
      ],
      { shutdownTimeout: 100 },
    );
    const hanging = fetch(`${url}/hang`).then(
      () => 'responded',
      () => 'dropped',
    );
    await started.promise;
    await server.close();
    expect(await hanging).toBe('dropped');
  });

  it.each(['bodyLimit', 'shutdownTimeout', 'requestTimeout', 'headersTimeout'])(
    'rejects an invalid %s',
    (name) => {
      expect(() => new HttpServer(new Router(), { [name]: -1 })).toThrow(RangeError);
      expect(() => new HttpServer(new Router(), { [name]: 1.5 })).toThrow(RangeError);
    },
  );
});
