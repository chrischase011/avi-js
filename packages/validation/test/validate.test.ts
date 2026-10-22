import { HttpServer, Router, reply, type Handler } from '@avijs/http';
import * as v from 'valibot';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkRouteSchema,
  queryObject,
  withValidation,
  type RouteSchema,
  type StandardSchemaV1,
} from '../src/index.js';

let server: HttpServer | undefined;
const logger = { error: vi.fn() };

afterEach(async () => {
  await server?.close();
  server = undefined;
  logger.error.mockReset();
});

async function serve(
  method: 'GET' | 'POST',
  path: string,
  schema: RouteSchema,
  handler: Handler,
): Promise<string> {
  const router = new Router();
  router.add([{ method, path, handler: withValidation(schema, handler) }]);
  server = new HttpServer(router, { logger });
  const { port } = await server.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${String(port)}`;
}

// A hand-written Standard Schema, to show no library is required.
const idParams: StandardSchemaV1<unknown, { id: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => {
      const n = Number((value as { id?: string }).id);
      return Number.isInteger(n) && n > 0
        ? { value: { id: n } }
        : { issues: [{ message: 'Expected a positive integer', path: [{ key: 'id' }] }] };
    },
  },
};

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('withValidation', () => {
  it('stores validated params, query and body on ctx.input', async () => {
    const url = await serve(
      'POST',
      '/users/:id',
      {
        params: v.object({ id: v.pipe(v.string(), v.transform(Number)) }),
        query: v.object({ tags: v.array(v.string()), dry: v.optional(v.string()) }),
        body: v.object({ name: v.pipe(v.string(), v.minLength(1)) }),
      },
      (ctx) => ctx.input,
    );
    const res = await fetch(`${url}/users/7?tags=a&tags=b`, post({ name: 'Ada', extra: true }));
    expect(await res.json()).toEqual({
      params: { id: 7 },
      query: { tags: ['a', 'b'] },
      body: { name: 'Ada' },
    });
  });

  it('works with a hand-written Standard Schema', async () => {
    const url = await serve('GET', '/items/:id', { params: idParams }, (ctx) => ctx.input);
    expect(await (await fetch(`${url}/items/5`)).json()).toEqual({ params: { id: 5 } });
    expect(await (await fetch(`${url}/items/0`)).json()).toMatchObject({
      details: { issues: [{ in: 'params', path: ['id'], message: 'Expected a positive integer' }] },
    });
  });

  it('reports every issue from every part as one 400', async () => {
    const handler = vi.fn();
    const url = await serve(
      'POST',
      '/users/:id',
      {
        params: v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/, 'id must be numeric')) }),
        query: v.object({ page: v.pipe(v.string(), v.regex(/^\d+$/, 'page must be numeric')) }),
        body: v.object({
          name: v.string('name is required'),
          age: v.number('age must be a number'),
        }),
      },
      handler,
    );
    const res = await fetch(`${url}/users/abc?page=x`, post({ name: 5, age: 'old' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: {
        issues: [
          { in: 'params', path: ['id'], message: 'id must be numeric' },
          { in: 'query', path: ['page'], message: 'page must be numeric' },
          { in: 'body', path: ['name'], message: 'name is required' },
          { in: 'body', path: ['age'], message: 'age must be a number' },
        ],
      },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps the JSON body rules', async () => {
    const url = await serve('POST', '/', { body: v.object({}) }, () => 'ok');
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(415);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
  });

  it('supports async schemas', async () => {
    const taken = new Set(['ada']);
    const url = await serve(
      'POST',
      '/',
      {
        body: v.objectAsync({
          name: v.pipeAsync(
            v.string(),
            v.checkAsync(async (name) => {
              await Promise.resolve();
              return !taken.has(name);
            }, 'name is taken'),
          ),
        }),
      },
      (ctx) => ctx.input,
    );
    expect((await fetch(url, post({ name: 'grace' }))).status).toBe(200);
    expect(await (await fetch(url, post({ name: 'ada' }))).json()).toMatchObject({
      details: { issues: [{ in: 'body', path: ['name'], message: 'name is taken' }] },
    });
  });
});

describe('response schemas', () => {
  const User = v.object({ id: v.number(), name: v.string() });

  it('sends the schema output, dropping undeclared fields', async () => {
    const url = await serve('GET', '/me', { response: User }, () => ({
      id: 1,
      name: 'Ada',
      passwordHash: 'secret',
    }));
    expect(await (await fetch(`${url}/me`)).json()).toEqual({ id: 1, name: 'Ada' });
  });

  it('keeps status and headers from reply()', async () => {
    const url = await serve('GET', '/me', { response: User }, () =>
      reply({ id: 2, name: 'Grace', internal: true }, { status: 201, headers: { 'x-id': '2' } }),
    );
    const res = await fetch(`${url}/me`);
    expect(res.status).toBe(201);
    expect(res.headers.get('x-id')).toBe('2');
    expect(await res.json()).toEqual({ id: 2, name: 'Grace' });
  });

  it('turns a mismatch into a logged 500', async () => {
    const url = await serve('GET', '/me', { response: User }, () => ({ id: 'not a number' }));
    const res = await fetch(`${url}/me`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error' });
    expect(logger.error).toHaveBeenCalledWith(
      'Request failed: GET /me',
      expect.objectContaining({ message: 'Response does not match its schema' }),
    );
  });
});

describe('checkRouteSchema', () => {
  it('accepts Standard Schemas and undefined', () => {
    expect(checkRouteSchema(undefined, 'Route')).toBeUndefined();
    expect(checkRouteSchema({ body: v.string() }, 'Route')).toBeDefined();
  });

  it.each<[string, unknown, string]>([
    ['a non-object', 'x', 'schema must be an object'],
    ['an unknown part', { headers: v.string() }, 'unknown part "headers"'],
    [
      'a plain object as a schema',
      { body: { name: 'string' } },
      'schema.body is not a Standard Schema',
    ],
  ])('rejects %s', (_, schema, message) => {
    expect(() => checkRouteSchema(schema, 'Route GET /')).toThrow(message);
  });
});

describe('queryObject', () => {
  it('keeps single values as strings and repeated keys as arrays', () => {
    const query = queryObject(new URLSearchParams('a=1&b=2&b=3&b=4&__proto__=x'));
    expect({ ...query }).toEqual({ a: '1', b: ['2', '3', '4'], ['__proto__']: 'x' });
    expect(Object.getPrototypeOf(query)).toBeNull();
  });
});
