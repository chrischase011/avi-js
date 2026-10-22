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

  it('rejects the same route from two controllers at init', async () => {
    const one = defineController({
      prefix: '/x',
      routes: [{ method: 'GET', path: '/', handler: () => 1 }],
    });
    const two = defineController({ routes: [{ method: 'GET', path: '/x', handler: () => 2 }] });
    const instance = createAvi().register({ controllers: [one, two] });
    await expect(instance.init()).rejects.toThrow('Duplicate route: GET /x');
  });

  it('refuses to listen when init fails, and keeps failing the same way', async () => {
    const bad = defineController({ routes: [{ method: 'GET', path: '/:1x', handler: () => 'x' }] });
    const instance = createAvi(silent).register({ controllers: [bad] });
    await expect(instance.listen(0, '127.0.0.1')).rejects.toThrow('Invalid parameter name');
    await expect(instance.init()).rejects.toThrow('Invalid parameter name');
    await instance.close();
  });

  it('routes parameters through controller prefixes', async () => {
    const users = defineController({
      prefix: '/users',
      routes: [
        { method: 'GET', path: '/me', handler: () => ({ id: 'me' }) },
        { method: 'GET', path: '/:id', handler: (ctx) => ({ id: ctx.params['id'] }) },
      ],
    });
    const url = await serve(createAvi().register({ controllers: [users] }));

    expect(await (await fetch(`${url}/users/me`)).json()).toEqual({ id: 'me' });
    expect(await (await fetch(`${url}/users/42`)).json()).toEqual({ id: '42' });
    expect(await (await fetch(`${url}/users/42/`)).json()).toEqual({ id: '42' });
  });

  it('applies a register prefix to every controller', async () => {
    const users = defineController({
      prefix: '/users',
      routes: [{ method: 'GET', path: '/', handler: () => 'users' }],
    });
    const health = defineController({
      routes: [{ method: 'GET', path: '/health', handler: () => 'ok' }],
    });
    const url = await serve(
      createAvi()
        .register({ prefix: '/api/v1', controllers: [users] })
        .register({ controllers: [health] }),
    );

    expect(await (await fetch(`${url}/api/v1/users`)).text()).toBe('users');
    expect(await (await fetch(`${url}/health`)).text()).toBe('ok');
    expect((await fetch(`${url}/users`)).status).toBe(404);
  });

  it('rejects a register prefix without a leading slash', () => {
    expect(() => createAvi().register({ prefix: 'api', controllers: [] })).toThrow(
      'Prefix must start with "/"',
    );
  });

  it('refuses to register after init()', async () => {
    const instance = createAvi();
    await instance.init();
    expect(() => instance.register({ controllers: [] })).toThrow('after init() or listen()');
  });

  it('passes server options through', async () => {
    const echo = defineController({
      routes: [{ method: 'POST', path: '/', handler: (ctx) => ctx.text() }],
    });
    const url = await serve(createAvi({ bodyLimit: 4 }).register({ controllers: [echo] }));
    expect((await fetch(url, { method: 'POST', body: '12345' })).status).toBe(413);
  });
});
