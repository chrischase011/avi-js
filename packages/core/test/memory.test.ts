// A leak in per-request state would show up as heap growth that scales with request count.
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { createAvi, createToken, defineController, route, type Middleware } from '../src/index.js';

const gc = (globalThis as { gc?: () => void }).gc;

async function settledHeap(): Promise<number> {
  if (!gc) throw new Error('Run with --expose-gc (configured in vitest.config.ts)');
  for (let i = 0; i < 3; i++) {
    gc();
    await new Promise((r) => setImmediate(r));
  }
  return process.memoryUsage().heapUsed;
}

async function hammer(url: string, count: number, concurrency = 25): Promise<void> {
  let next = 0;
  const body = JSON.stringify({ name: 'Ada' });
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const i = next++;
        const res =
          i % 2 === 0
            ? await fetch(`${url}/users/${String(i)}?q=x`)
            : await fetch(`${url}/users`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
              });
        await res.arrayBuffer();
      }
    }),
  );
}

describe('memory', () => {
  it(
    'stays flat across thousands of requests through the full pipeline',
    { timeout: 120_000 },
    async () => {
      const Store = createToken<Map<string, string>>('Store');
      const tag: Middleware = async (ctx, next) => {
        ctx.state['started'] = Date.now();
        ctx.setHeader('x-request', 'r');
        return next();
      };
      const users = defineController({
        prefix: '/users',
        inject: [Store],
        routes: (store) => [
          route({
            method: 'GET',
            path: '/:id',
            handler: (ctx) => ({ id: ctx.params.id, n: store.size }),
          }),
          route({
            method: 'POST',
            path: '/',
            schema: { body: v.object({ name: v.string() }) },
            handler: (ctx) => ({ name: ctx.input.body.name }),
          }),
        ],
      });
      const app = createAvi({ middleware: [tag], guards: [() => true] }).register({
        providers: [{ provide: Store, useValue: new Map() }],
        controllers: [users],
      });
      const { port } = await app.listen(0, '127.0.0.1');
      const url = `http://127.0.0.1:${String(port)}`;

      try {
        await hammer(url, 1_000);
        const before = await settledHeap();
        await hammer(url, 6_000);
        const after = await settledHeap();
        const growthMb = (after - before) / 1024 / 1024;
        // 6,000 requests retained at even 1 KB each would add about 6 MB.
        expect(growthMb).toBeLessThan(4);
      } finally {
        await app.close();
      }
    },
  );
});
