import * as v from 'valibot';
import { HttpError, defineController, route, type RouteEndpoint } from '@avijs/core';
import { afterEach, expect, expectTypeOf, it } from 'vitest';
import { createTestClient, type TestClient } from '../src/index.js';

const CreateNote = v.object({ text: v.pipe(v.string(), v.minLength(1)) });

const notes = defineController({
  prefix: '/notes',
  routes: [
    route({
      method: 'GET',
      path: '/:id',
      handler: (ctx) => {
        if (ctx.params.id !== '1') throw new HttpError(404, 'Note not found');
        return { id: 1, text: 'hello', at: new Date(0) };
      },
    }),
    route({
      method: 'POST',
      path: '/',
      schema: { body: CreateNote },
      handler: (ctx) => ({ id: 2, text: ctx.input.body.text }),
    }),
  ],
});

interface Api {
  'GET /notes/:id': RouteEndpoint<'/notes/:id', typeof notes, 0>;
  'POST /notes': RouteEndpoint<'/notes', typeof notes, 1>;
}

let client: TestClient<Api> | undefined;
afterEach(() => client?.close());

it('types client.api calls by the generated Api', async () => {
  client = await createTestClient<Api>({ controllers: [notes] });

  const found = await client.api.get('/notes/:id', { params: { id: 1 } });
  expect(found.ok).toBe(true);
  if (found.ok) {
    expectTypeOf(found.body).toEqualTypeOf<{ id: number; text: string; at: string }>();
    expect(found.body.at).toBe('1970-01-01T00:00:00.000Z');
  }

  // A status never throws; the error body is there to assert on.
  const missing = await client.api.get('/notes/:id', { params: { id: 7 } });
  expect(missing.status).toBe(404);
  expect(missing.body).toMatchObject({ message: 'Note not found' });

  const created = await client.api.post('/notes', { body: { text: 'new' } });
  expect(created).toMatchObject({ ok: true, status: 200, body: { id: 2, text: 'new' } });

  // @ts-expect-error the body schema needs text
  await client.api.post('/notes', { body: {} }).catch(() => undefined);
  // The untyped calls still work.
  expect((await client.get('/notes/1')).ok).toBe(true);
});

it('keeps the Api type through withHeaders', async () => {
  client = await createTestClient<Api>({ controllers: [notes] });
  const signedIn = client.withHeaders({ authorization: 'Bearer t' });
  expectTypeOf(signedIn).toEqualTypeOf<TestClient<Api>>();
  const found = await signedIn.api.get('/notes/:id', { params: { id: 1 } });
  expect(found.ok).toBe(true);
});
