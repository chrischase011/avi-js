import {
  createAvi,
  createToken,
  defineController,
  defineModule,
  route,
  type Middleware,
} from '@avijs/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestClient, type TestClient } from '../src/index.js';

interface Mailer {
  send(to: string): string;
}
const Mailer = createToken<Mailer>('Mailer');

const users = defineController({
  prefix: '/users',
  inject: [Mailer],
  routes: (mailer) => [
    route({ method: 'GET', path: '/', handler: (ctx) => ({ tags: ctx.query.getAll('tag') }) }),
    route({
      method: 'POST',
      path: '/',
      handler: async (ctx) => ({
        sent: mailer.send(((await ctx.json()) as { email: string }).email),
      }),
    }),
    route({ method: 'GET', path: '/text', handler: () => 'plain text' }),
    route({
      method: 'GET',
      path: '/whoami',
      handler: (ctx) => ({ auth: ctx.headers.authorization, lang: ctx.headers['accept-language'] }),
    }),
    route({ method: 'DELETE', path: '/:id', handler: () => undefined }),
  ],
});

const Mail = defineModule({
  name: 'Mail',
  providers: [{ provide: Mailer, useValue: { send: (to: string) => `real mail to ${to}` } }],
  exports: [Mailer],
});
const AppModule = defineModule({ name: 'AppModule', imports: [Mail], controllers: [users] });

let client: TestClient | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('createTestClient', () => {
  it('sends JSON and parses JSON responses', async () => {
    client = await createTestClient(AppModule);
    const res = await client.post('/users', { email: 'ada@example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 'real mail to ada@example.com' });
  });

  it('replaces providers anywhere in the app with overrides', async () => {
    client = await createTestClient(AppModule, {
      overrides: [{ provide: Mailer, useValue: { send: (to: string) => `fake mail to ${to}` } }],
    });
    expect((await client.post('/users', { email: 'x' })).body).toEqual({ sent: 'fake mail to x' });
  });

  it('builds query strings, including repeated keys', async () => {
    client = await createTestClient(AppModule);
    expect((await client.get('/users', { query: { tag: ['a', 'b'] } })).body).toEqual({
      tags: ['a', 'b'],
    });
  });

  it('returns text bodies and empty responses', async () => {
    client = await createTestClient(AppModule);
    expect((await client.get('/users/text')).body).toBe('plain text');
    const removed = await client.delete('/users/1');
    expect(removed.status).toBe(204);
    expect(removed.text).toBe('');
  });

  it('accepts an app built by hand', async () => {
    const stamp: Middleware = (ctx, next) => {
      ctx.setHeader('x-test', 'yes');
      return next();
    };
    client = await createTestClient(createAvi({ middleware: [stamp] }).register(AppModule));
    expect((await client.get('/users')).headers.get('x-test')).toBe('yes');
  });

  it('disposes providers on close', async () => {
    const events: string[] = [];
    class Resource {
      [Symbol.dispose]() {
        events.push('disposed');
      }
    }
    const test = await createTestClient({ providers: [Resource] });
    await test.close();
    expect(events).toEqual(['disposed']);
  });
});

describe('withHeaders', () => {
  it('sends default headers that a call can override, without changing the original', async () => {
    client = await createTestClient(AppModule);
    const shiela = client.withHeaders({ Authorization: 'Bearer shiela', 'accept-language': 'en' });
    const grace = shiela.withHeaders({ authorization: 'Bearer grace' });

    expect((await shiela.get('/users/whoami')).body).toEqual({ auth: 'Bearer shiela', lang: 'en' });
    expect((await grace.get('/users/whoami')).body).toEqual({ auth: 'Bearer grace', lang: 'en' });
    const override = await shiela.get('/users/whoami', { headers: { authorization: 'Bearer x' } });
    expect(override.body).toEqual({ auth: 'Bearer x', lang: 'en' });
    expect((await client.get('/users/whoami')).body).not.toHaveProperty('auth');
  });
});

describe('headers', () => {
  it('accepts Headers objects and tuple arrays, as typed calls allow', async () => {
    client = await createTestClient(AppModule);
    const fromHeaders = await client.get('/users/whoami', {
      headers: new Headers({ authorization: 'Bearer a' }),
    });
    expect(fromHeaders.body).toMatchObject({ auth: 'Bearer a' });
    const fromTuples = await client
      .withHeaders([['authorization', 'Bearer b']])
      .get('/users/whoami');
    expect(fromTuples.body).toMatchObject({ auth: 'Bearer b' });
  });
});
