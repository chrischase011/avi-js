import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, reply, type RequestHook } from '../src/index.js';
import { startServer, type TestServer } from './helpers.js';

let current: TestServer | undefined;

afterEach(async () => {
  await current?.server.close();
  current = undefined;
});

async function start(onRequest: RequestHook[]) {
  current = await startServer(
    [
      { method: 'GET', path: '/users', handler: () => ['ada'] },
      { method: 'POST', path: '/users', handler: () => 'created' },
    ],
    { onRequest },
  );
  return current.url;
}

describe('onRequest hooks', () => {
  it('run in order before the handler and continue on undefined', async () => {
    const calls: string[] = [];
    const url = await start([
      () => {
        calls.push('a');
      },
      async () => {
        await Promise.resolve();
        calls.push('b');
      },
    ]);

    const res = await fetch(`${url}/users`);
    expect(await res.json()).toEqual(['ada']);
    expect(calls).toEqual(['a', 'b']);
  });

  it('send a returned value instead of routing', async () => {
    const later = vi.fn();
    const url = await start([() => reply('stopped', { status: 202 }), later]);

    const res = await fetch(`${url}/users`);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('stopped');
    expect(later).not.toHaveBeenCalled();
  });

  it('run for 404, 405 and automatic OPTIONS, keeping their headers', async () => {
    const url = await start([
      (ctx) => {
        ctx.setHeader('x-hook', ctx.path);
      },
    ]);

    const missing = await fetch(`${url}/nope`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-hook')).toBe('/nope');

    const wrong = await fetch(`${url}/users`, { method: 'DELETE' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('x-hook')).toBe('/users');

    const options = await fetch(`${url}/users`, { method: 'OPTIONS' });
    expect(options.status).toBe(204);
    expect(options.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');
    expect(options.headers.get('x-hook')).toBe('/users');
  });

  it('turn sync and async errors into error responses', async () => {
    const url = await start([
      (ctx) => {
        if (ctx.query.has('sync')) throw new HttpError(401);
      },
      (ctx) => (ctx.query.has('async') ? Promise.reject(new HttpError(429)) : undefined),
    ]);

    expect((await fetch(`${url}/users?sync`)).status).toBe(401);
    expect((await fetch(`${url}/users?async`)).status).toBe(429);
    expect((await fetch(`${url}/users`)).status).toBe(200);
  });

  it('rejects anything but an array of functions', async () => {
    await expect(startServer([], { onRequest: [1 as never] })).rejects.toThrow(
      'onRequest must be an array of functions',
    );
  });
});
