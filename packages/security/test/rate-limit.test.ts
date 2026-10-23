import { HttpServer, Router, compose, type RequestHook, type RouteDefinition } from '@avijs/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStore, rateLimit, type RateLimitStore } from '../src/index.js';

let server: HttpServer | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
});

async function start(hooks: RequestHook[], routes: RouteDefinition[] = []): Promise<string> {
  const router = new Router();
  router.add([{ method: 'GET', path: '/', handler: () => 'ok' }, ...routes]);
  server = new HttpServer(router, { onRequest: hooks, logger: { error: () => undefined } });
  const { port } = await server.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${String(port)}`;
}

const get = async (url: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { headers });
  await res.arrayBuffer();
  return res;
};

describe('rateLimit', () => {
  it('allows the limit, then answers 429 with Retry-After', async () => {
    const url = await start([rateLimit({ limit: 2, window: 60_000 })]);

    const first = await get(url);
    expect(first.status).toBe(200);
    expect(first.headers.get('ratelimit-limit')).toBe('2');
    expect(first.headers.get('ratelimit-remaining')).toBe('1');
    expect(Number(first.headers.get('ratelimit-reset'))).toBeGreaterThan(55);

    expect((await get(url)).headers.get('ratelimit-remaining')).toBe('0');

    const limited = await get(url);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(limited.headers.get('ratelimit-remaining')).toBe('0');
  });

  it('counts by a custom key', async () => {
    const url = await start([
      rateLimit({ limit: 1, window: 60_000, key: (ctx) => String(ctx.headers['x-api-key']) }),
    ]);
    expect((await get(url, { 'x-api-key': 'a' })).status).toBe(200);
    expect((await get(url, { 'x-api-key': 'b' })).status).toBe(200);
    expect((await get(url, { 'x-api-key': 'a' })).status).toBe(429);
  });

  it('limits one route with .guard, with its own counter', async () => {
    const login = rateLimit({ limit: 1, window: 60_000 });
    // compose() is how Avi.js runs a route's middleware and guards.
    const url = await start(
      [],
      [{ method: 'POST', path: '/login', handler: compose([], [login.guard], () => 'in') }],
    );
    const post = () => fetch(`${url}/login`, { method: 'POST' });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(429);
    expect((await get(url)).status).toBe(200);
  });

  it('counts exactly under concurrency', async () => {
    const url = await start([rateLimit({ limit: 10, window: 60_000 })]);
    const statuses = await Promise.all(
      Array.from({ length: 20 }, async () => (await get(url)).status),
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(10);
  });

  it('lets requests through or rejects them when the store fails', async () => {
    const broken: RateLimitStore = { increment: () => Promise.reject(new Error('redis down')) };
    const logger = { error: vi.fn() };
    const url = await start([rateLimit({ limit: 1, window: 1000, store: broken, logger })]);
    expect((await get(url)).status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(
      'Rate limit store failed: GET /',
      expect.objectContaining({ message: 'redis down' }),
    );
    await server?.close();

    const strict = await start([
      rateLimit({ limit: 1, window: 1000, store: broken, onStoreError: 'deny', logger }),
    ]);
    expect((await get(strict)).status).toBe(503);
  });

  it('validates its options', () => {
    expect(() => rateLimit({ limit: 0, window: 1000 })).toThrow('limit must be a positive integer');
    expect(() => rateLimit({ limit: 1, window: 1.5 })).toThrow('window must be a positive integer');
  });
});

describe('memoryStore', () => {
  it('starts a new window after the old one ends', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const store = memoryStore();
    expect(store.increment('a', 100)).toEqual({ count: 1, resetAt: 1_100 });
    expect(store.increment('a', 100)).toEqual({ count: 2, resetAt: 1_100 });
    now.mockReturnValue(1_100);
    expect(store.increment('a', 100)).toEqual({ count: 1, resetAt: 1_200 });
  });

  it('caps the keys it tracks, dropping the oldest window', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const store = memoryStore({ maxKeys: 2 });
    store.increment('a', 1000);
    store.increment('a', 1000);
    store.increment('b', 1000);
    store.increment('c', 1000);
    // 'a' was dropped to make room, so it starts again at 1.
    expect(store.increment('a', 1000)).toEqual({ count: 1, resetAt: 1000 });
    expect(store.increment('c', 1000)).toEqual({ count: 2, resetAt: 1000 });
  });
});
