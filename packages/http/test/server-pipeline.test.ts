import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  compose,
  jsonLogger,
  reply,
  type Context,
  type ResponseInfo,
  type RouteDefinition,
  type ServerOptions,
} from '../src/index.js';
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

describe('ctx.state and ctx.setHeader', () => {
  it('gives every request a fresh state object', async () => {
    const seen: unknown[] = [];
    const { url } = await start([
      get('/', (ctx) => {
        seen.push({ ...ctx.state });
        ctx.state['visited'] = true;
        return 'ok';
      }),
    ]);
    await fetch(url);
    await fetch(url);
    expect(seen).toEqual([{}, {}]);
  });

  it('sends headers set during the request', async () => {
    const { url } = await start([
      get('/', (ctx) => {
        ctx.setHeader('X-Request-Id', 'abc');
        ctx.setHeader('x-multi', ['1', '2']);
        return 'ok';
      }),
    ]);
    const res = await fetch(url);
    expect(res.headers.get('x-request-id')).toBe('abc');
    expect(res.headers.get('x-multi')).toBe('1, 2');
  });

  it('lets reply headers win over ctx headers', async () => {
    const { url } = await start([
      get('/', (ctx) => {
        ctx.setHeader('cache-control', 'no-store');
        ctx.setHeader('x-kept', 'yes');
        return reply('ok', { headers: { 'cache-control': 'max-age=60' } });
      }),
    ]);
    const res = await fetch(url);
    expect(res.headers.get('cache-control')).toBe('max-age=60');
    expect(res.headers.get('x-kept')).toBe('yes');
  });

  it('keeps ctx headers on error responses, with error headers winning', async () => {
    const { url } = await start([
      get('/', (ctx) => {
        ctx.setHeader('x-request-id', 'abc');
        ctx.setHeader('retry-after', '1');
        throw new HttpError(429, 'Slow down', { headers: { 'retry-after': '30' } });
      }),
    ]);
    const res = await fetch(url);
    expect(res.status).toBe(429);
    expect(res.headers.get('x-request-id')).toBe('abc');
    expect(res.headers.get('retry-after')).toBe('30');
  });

  it('sends errors as JSON even when the handler had set a body type or caching', async () => {
    const page = (ctx: Context) => {
      ctx.setHeader('content-type', 'text/html; charset=utf-8');
      ctx.setHeader('content-encoding', 'gzip');
      ctx.setHeader('cache-control', 'public, max-age=3600');
      ctx.setHeader('etag', '"v1"');
      ctx.setHeader('x-request-id', 'abc');
      ctx.setHeader('content-security-policy', "default-src 'none'");
      // A message built from user input must not be served as HTML.
      throw new HttpError(404, `No page <img src=x onerror=alert(1)>`);
    };
    for (const errorHandler of [undefined, (error: unknown) => ({ handled: String(error) })]) {
      const { url } = await start([get('/', page)], errorHandler ? { errorHandler } : {});
      const res = await fetch(url);
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
      for (const name of ['content-encoding', 'cache-control', 'etag']) {
        expect(res.headers.get(name)).toBeNull();
      }
      expect(res.headers.get('x-request-id')).toBe('abc');
      // Security headers stay, even though their names start with content-.
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
      expect(await res.json()).toBeTypeOf('object');
      await current?.server.close();
    }
  });

  it('answers 500 whatever is thrown and whatever the logger does', async () => {
    const lines: string[] = [];
    const loggers = [
      jsonLogger({ write: (line) => lines.push(line) }),
      {
        error: () => {
          throw new Error('logger down');
        },
      },
    ];
    const odd = Object.create(null) as object;
    for (const logger of loggers) {
      const { url } = await start(
        [
          get('/sync', () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- what apps can throw
            throw odd;
          }),
          get('/async', () => Promise.reject(new Error('x', { cause: odd }))),
        ],
        { logger },
      );
      for (const path of ['/sync', '/async']) {
        const res = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000) });
        expect(res.status).toBe(500);
      }
      await current?.server.close();
    }
    expect(lines).toHaveLength(2);
    expect(lines.join('')).toContain('[unprintable value]');
  });

  it('rejects invalid headers where they are set', async () => {
    const { url, logger } = await start([
      get('/', (ctx) => {
        ctx.setHeader('x-bad', 'a\nb');
        return 'never';
      }),
    ]);
    expect((await fetch(url)).status).toBe(500);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe('errorHandler', () => {
  it('uses the error status when the handler returns a plain value', async () => {
    const { url } = await start(
      [
        get('/', () => {
          throw new HttpError(422, 'Name is required');
        }),
      ],
      {
        errorHandler: (error) => ({
          type: 'about:blank',
          detail: error instanceof Error ? error.message : 'unknown',
        }),
      },
    );
    const res = await fetch(url);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ type: 'about:blank', detail: 'Name is required' });
  });

  it('can set its own status and headers with reply', async () => {
    const { url } = await start(
      [
        get('/', () => {
          throw new Error('db down');
        }),
      ],
      {
        errorHandler: () =>
          reply(
            { title: 'Try later' },
            { status: 503, headers: { 'content-type': 'application/problem+json' } },
          ),
      },
    );
    const res = await fetch(url);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('handles 404 and keeps the Allow header on 405', async () => {
    const errorHandler = vi.fn((error: unknown) => ({ problem: (error as HttpError).status }));
    const { url } = await start([get('/items', () => [])], { errorHandler });

    const missing = await fetch(`${url}/nope`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ problem: 404 });

    const wrong = await fetch(`${url}/items`, { method: 'DELETE' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    expect(errorHandler).toHaveBeenCalledTimes(2);
  });

  it('may be async', async () => {
    const { url } = await start(
      [
        get('/', () => {
          throw new HttpError(400);
        }),
      ],
      { errorHandler: () => Promise.resolve({ async: true }) },
    );
    const res = await fetch(url);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ async: true });
  });

  it('falls back to the safe response and logs when it fails', async () => {
    const original = new Error('secret');
    const { url, logger } = await start(
      [
        get('/', () => {
          throw original;
        }),
      ],
      {
        errorHandler: () => {
          throw new Error('handler bug');
        },
      },
    );
    const res = await fetch(url);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error' });
    expect(logger.error).toHaveBeenCalledWith(
      'Request failed: GET /',
      original,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'errorHandler failed: GET /',
      expect.objectContaining({ message: 'handler bug' }),
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('onResponse', () => {
  it('reports method, path, route pattern, status and duration', async () => {
    const infos: ResponseInfo[] = [];
    const done = deferred();
    const { url } = await start([get('/users/:id', () => 'ok')], {
      onResponse: (info) => {
        infos.push(info);
        if (infos.length === 2) done.resolve();
      },
    });
    await (await fetch(`${url}/users/7?x=1`)).text();
    await (await fetch(`${url}/missing`)).text();
    await done.promise;

    expect(infos[0]).toMatchObject({
      method: 'GET',
      path: '/users/7',
      route: '/users/:id',
      status: 200,
      aborted: false,
    });
    expect(infos[0]?.duration).toBeGreaterThanOrEqual(0);
    expect(infos[1]).toMatchObject({ path: '/missing', route: undefined, status: 404 });
  });

  it('marks responses the client abandoned', async () => {
    const started = deferred();
    const reported = deferred<ResponseInfo>();
    const { port } = await start(
      [
        get('/slow', () => {
          started.resolve();
          return new Promise(() => undefined);
        }),
      ],
      {
        onResponse: (info) => {
          reported.resolve(info);
        },
      },
    );
    const req = httpRequest({ port, host: '127.0.0.1', path: '/slow' });
    req.on('error', () => undefined);
    req.end();
    await started.promise;
    req.destroy();
    expect((await reported.promise).aborted).toBe(true);
  });

  it('logs hook errors without affecting the response', async () => {
    const logged = deferred();
    const { url, logger } = await start([get('/', () => 'ok')], {
      onResponse: () => Promise.reject(new Error('metrics down')),
    });
    logger.error.mockImplementation(() => {
      logged.resolve();
    });
    expect(await (await fetch(url)).text()).toBe('ok');
    await logged.promise;
    expect(logger.error).toHaveBeenCalledWith(
      'onResponse failed',
      expect.objectContaining({ message: 'metrics down' }),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects options that are not functions', async () => {
    await expect(start([], { onResponse: 'nope' as never })).rejects.toThrow(
      'onResponse must be a function',
    );
  });
});

describe('isolation', () => {
  it('keeps state and headers separate across concurrent requests', async () => {
    const { url } = await start([
      get(
        '/whoami',
        compose(
          [
            async (ctx, next) => {
              const id = ctx.query.get('id') ?? '';
              ctx.state['id'] = id;
              ctx.setHeader('x-id', id);
              await new Promise((r) => setTimeout(r, Number(id) % 7));
              return next();
            },
          ],
          [],
          (ctx) => ({ state: ctx.state['id'] }),
        ),
      ),
    ]);

    const ids = Array.from({ length: 200 }, (_, i) => String(i));
    const results = await Promise.all(
      ids.map(async (id) => {
        const res = await fetch(`${url}/whoami?id=${id}`);
        return {
          id,
          header: res.headers.get('x-id'),
          body: (await res.json()) as { state: string },
        };
      }),
    );
    for (const { id, header, body } of results) {
      expect(header).toBe(id);
      expect(body.state).toBe(id);
    }
  });
});
