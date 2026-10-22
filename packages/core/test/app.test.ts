import { afterEach, describe, expect, it } from 'vitest';
import { createAvi, defineController, reply, type AviApp } from '../src/index.js';

let app: AviApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const silent = { logger: { error: () => undefined } };

async function serve(instance: AviApp): Promise<string> {
  app = instance;
  const { port } = await instance.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${String(port)}`;
}

describe('createAvi', () => {
  it('serves a Hello World app', async () => {
    const hello = defineController({
      routes: [
        { method: 'GET', path: '/', handler: () => ({ message: 'Hello, Avi' }) },
        { method: 'GET', path: '/health', handler: () => 'ok' },
      ],
    });
    const url = await serve(createAvi().register({ controllers: [hello] }));

    expect(await (await fetch(url)).json()).toEqual({ message: 'Hello, Avi' });
    expect(await (await fetch(`${url}/health`)).text()).toBe('ok');
  });

  it('prefixes controller routes', async () => {
    const users = defineController({
      prefix: '/users',
      routes: [
        { method: 'GET', path: '/', handler: () => [{ id: 1 }] },
        { method: 'POST', path: '/', handler: () => reply({ id: 2 }, { status: 201 }) },
        { method: 'GET', path: '/me', handler: () => ({ id: 'me' }) },
      ],
    });
    const url = await serve(createAvi().register({ controllers: [users] }));

    expect(await (await fetch(`${url}/users`)).json()).toEqual([{ id: 1 }]);
    expect((await fetch(`${url}/users`, { method: 'POST' })).status).toBe(201);
    expect(await (await fetch(`${url}/users/me`)).json()).toEqual({ id: 'me' });
    expect((await fetch(`${url}/me`)).status).toBe(404);
  });

  it('supports chained register calls', async () => {
    const a = defineController({
      prefix: '/a',
      routes: [{ method: 'GET', path: '/', handler: () => 'a' }],
    });
    const b = defineController({
      prefix: '/b',
      routes: [{ method: 'GET', path: '/', handler: () => 'b' }],
    });
    const url = await serve(
      createAvi()
        .register({ controllers: [a] })
        .register({ controllers: [b] }),
    );

    expect(await (await fetch(`${url}/a`)).text()).toBe('a');
    expect(await (await fetch(`${url}/b`)).text()).toBe('b');
  });

  it('rejects the same route from two controllers', () => {
    const one = defineController({
      prefix: '/x',
      routes: [{ method: 'GET', path: '/', handler: () => 1 }],
    });
    const two = defineController({ routes: [{ method: 'GET', path: '/x', handler: () => 2 }] });
    expect(() => createAvi().register({ controllers: [one, two] })).toThrow(
      'Duplicate route: GET /x',
    );
  });

  it('keeps nothing from a register call that fails', async () => {
    const good = defineController({
      routes: [{ method: 'GET', path: '/good', handler: () => 'ok' }],
    });
    const bad = defineController({ routes: [{ method: 'GET', path: '/:id', handler: () => 'x' }] });
    const instance = createAvi(silent);
    expect(() => instance.register({ controllers: [good, bad] })).toThrow('not supported yet');

    const url = await serve(instance);
    expect((await fetch(`${url}/good`)).status).toBe(404);
  });

  it('refuses to register after listen()', async () => {
    const instance = createAvi();
    await serve(instance);
    expect(() => instance.register({ controllers: [] })).toThrow('after listen()');
  });

  it('passes server options through', async () => {
    const echo = defineController({
      routes: [{ method: 'POST', path: '/', handler: (ctx) => ctx.text() }],
    });
    const url = await serve(createAvi({ bodyLimit: 4 }).register({ controllers: [echo] }));
    expect((await fetch(url, { method: 'POST', body: '12345' })).status).toBe(413);
  });
});
