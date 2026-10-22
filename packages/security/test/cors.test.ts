import { HttpServer, Router, reply, type RequestHook } from '@avijs/http';
import { afterEach, describe, expect, it } from 'vitest';
import { cors, type CorsOptions } from '../src/index.js';

let server: HttpServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(hooks: RequestHook[]): Promise<string> {
  const router = new Router();
  router.add([
    { method: 'GET', path: '/users', handler: () => ['ada'] },
    { method: 'POST', path: '/users', handler: () => reply('ok', { headers: { vary: 'Accept' } }) },
  ]);
  server = new HttpServer(router, { onRequest: hooks, logger: { error: () => undefined } });
  const { port } = await server.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${String(port)}`;
}

const startCors = (options: CorsOptions) => start([cors(options)]);

async function send(url: string, method: string, headers: Record<string, string>) {
  const res = await fetch(url, { method, headers });
  await res.arrayBuffer();
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers) as Record<string, string | undefined>,
  };
}

const APP = 'https://app.example.com';
const preflight = (extra: Record<string, string> = {}) => ({
  origin: APP,
  'access-control-request-method': 'POST',
  ...extra,
});

describe('cors', () => {
  it('answers a preflight for an allowed origin', async () => {
    const url = await startCors({ origin: APP, maxAge: 600 });
    const res = await send(
      `${url}/users`,
      'OPTIONS',
      preflight({
        'access-control-request-headers': 'content-type, x-trace',
      }),
    );

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(APP);
    expect(res.headers['access-control-allow-methods']).toBe('GET, HEAD, PUT, PATCH, POST, DELETE');
    expect(res.headers['access-control-allow-headers']).toBe('content-type, x-trace');
    expect(res.headers['access-control-max-age']).toBe('600');
    expect(res.headers['vary']).toBe('Origin, Access-Control-Request-Headers');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers preflights for paths without a route too', async () => {
    const url = await startCors({ origin: APP });
    const res = await send(`${url}/anything`, 'OPTIONS', preflight());
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(APP);
  });

  it('uses configured methods and headers instead of reflecting', async () => {
    const url = await startCors({ origin: APP, methods: ['GET'], allowedHeaders: ['x-a'] });
    const res = await send(
      `${url}/users`,
      'OPTIONS',
      preflight({
        'access-control-request-headers': 'x-b',
      }),
    );
    expect(res.headers['access-control-allow-methods']).toBe('GET');
    expect(res.headers['access-control-allow-headers']).toBe('x-a');
    expect(res.headers['vary']).toBe('Origin');
  });

  it('does not reflect malformed requested headers', async () => {
    const url = await startCors({ origin: APP });
    const res = await send(
      `${url}/users`,
      'OPTIONS',
      preflight({
        'access-control-request-headers': 'x-a; drop',
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toBeUndefined();
  });

  it('adds headers to simple requests and keeps reply() headers', async () => {
    const url = await startCors({ origin: [APP], credentials: true, exposedHeaders: ['x-total'] });

    const get = await send(`${url}/users`, 'GET', { origin: APP });
    expect(get.status).toBe(200);
    expect(get.headers['access-control-allow-origin']).toBe(APP);
    expect(get.headers['access-control-allow-credentials']).toBe('true');
    expect(get.headers['access-control-expose-headers']).toBe('x-total');
    expect(get.headers['vary']).toBe('Origin');

    const post = await send(`${url}/users`, 'POST', { origin: APP });
    expect(post.headers['access-control-allow-origin']).toBe(APP);
    expect(post.headers['vary']).toBe('Accept');
  });

  it('adds headers to error responses', async () => {
    const url = await startCors({ origin: APP });
    const res = await send(`${url}/missing`, 'GET', { origin: APP });
    expect(res.status).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe(APP);
  });

  it('leaves other origins without CORS headers', async () => {
    const url = await startCors({ origin: APP });

    const res = await send(`${url}/users`, 'GET', { origin: 'https://evil.example' });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['vary']).toBe('Origin');

    const pre = await send(`${url}/users`, 'OPTIONS', {
      ...preflight(),
      origin: 'https://evil.example',
    });
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    expect(pre.headers['allow']).toBe('GET, HEAD, POST, OPTIONS');
  });

  it("allows any origin with '*'", async () => {
    const url = await startCors({ origin: '*' });
    const res = await send(`${url}/users`, 'GET', { origin: 'https://other.example' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['vary']).toBeUndefined();
  });

  it('matches with a RegExp or a function', async () => {
    const url = await start([
      cors({ origin: /^https:\/\/[a-z]+\.example\.com$/g }),
      cors({ origin: (origin) => origin.endsWith('.test'), exposedHeaders: ['x-fn'] }),
    ]);

    for (let i = 0; i < 2; i++) {
      const res = await send(`${url}/users`, 'GET', { origin: APP });
      expect(res.headers['access-control-allow-origin']).toBe(APP);
    }
    const fn = await send(`${url}/users`, 'GET', { origin: 'http://local.test' });
    expect(fn.headers['access-control-expose-headers']).toBe('x-fn');
  });

  it('only echoes the request origin when the matcher allows it', async () => {
    const url = await startCors({ origin: () => true });
    const res = await send(`${url}/users`, 'GET', { origin: 'null' });
    expect(res.headers['access-control-allow-origin']).toBe('null');
  });

  it('rejects unsafe or invalid configuration', () => {
    expect(() => cors({ origin: '*', credentials: true })).toThrow(/credentials/);
    expect(() => cors({ origin: 'https://app.example.com/' })).toThrow(/not an origin/);
    expect(() => cors({ origin: 'app.example.com' })).toThrow(/not an origin/);
    expect(() => cors({ origin: [] })).toThrow(/must be set/);
    expect(() => cors({ origin: APP, maxAge: -1 })).toThrow(/maxAge/);
  });
});
