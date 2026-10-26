import { describe, expect, it } from 'vitest';
import {
  createAvi,
  createToken,
  defineController,
  defineHook,
  route,
  type AviApp,
  type RequestHook,
} from '../src/index.js';

const Origin = createToken<string>('Origin');
const settings = { providers: [{ provide: Origin, useValue: 'https://app.example.com' }] };
const ping = defineController({
  routes: [route({ method: 'GET', path: '/ping', handler: () => 'pong' })],
});

async function serve(app: AviApp): Promise<string> {
  const { port } = await app.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${String(port)}`;
}

describe('defineHook', () => {
  it('builds a hook from injected values and keeps the order of onRequest', async () => {
    const order: string[] = [];
    const first: RequestHook = () => {
      order.push('first');
    };
    const cors = defineHook({
      inject: [Origin],
      create: (origin) => (ctx) => {
        order.push('cors');
        ctx.setHeader('access-control-allow-origin', origin);
      },
    });
    const last: RequestHook = () => {
      order.push('last');
    };
    const app = createAvi({ startupSummary: false, onRequest: [first, cors, last] }).register({
      ...settings,
      controllers: [ping],
    });
    const base = await serve(app);
    try {
      const res = await fetch(`${base}/ping`);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
      expect(order).toEqual(['first', 'cors', 'last']);
      // Hooks run before routing, so a 404 gets them too.
      const missing = await fetch(`${base}/nowhere`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    } finally {
      await app.close();
    }
  });

  it('can answer a request, like any hook', async () => {
    const closed = defineHook({ create: () => () => 'maintenance' });
    const app = createAvi({ startupSummary: false, onRequest: [closed] }).register({
      controllers: [ping],
    });
    const base = await serve(app);
    try {
      expect(await (await fetch(`${base}/ping`)).text()).toBe('maintenance');
    } finally {
      await app.close();
    }
  });

  it('fails at startup when a token is missing or create returns no function', async () => {
    const missing = createAvi({
      startupSummary: false,
      onRequest: [defineHook({ inject: [Origin], create: (origin) => () => origin })],
    });
    await expect(missing.init()).rejects.toThrow('Origin');

    const broken = createAvi({
      startupSummary: false,
      onRequest: [defineHook({ create: () => 'nope' as unknown as RequestHook })],
    });
    await expect(broken.init()).rejects.toThrow('create must return a request hook function');
  });

  it('rejects a definition without create', () => {
    expect(() => defineHook({} as never)).toThrow('defineHook needs a create function');
  });
});
