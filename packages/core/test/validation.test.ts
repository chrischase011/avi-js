import * as v from 'valibot';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Controller,
  Get,
  Post,
  UseGuards,
  createAvi,
  defineController,
  reply,
  route,
  type AviApp,
  type Context,
  type InferOutput,
} from '../src/index.js';

const running: AviApp[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()));
});

async function serve(app: AviApp): Promise<string> {
  running.push(app);
  const { port } = await app.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${String(port)}`;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const CreateUser = v.object({ name: v.pipe(v.string(), v.minLength(1, 'name is required')) });
const UserId = v.object({
  id: v.pipe(v.string(), v.regex(/^\d+$/, 'id must be numeric'), v.transform(Number)),
});
const Paging = v.object({ page: v.optional(v.pipe(v.string(), v.transform(Number)), '1') });
const PublicUser = v.object({ id: v.number(), name: v.string() });

describe('route() with schemas', () => {
  it('validates and types params, query and body', async () => {
    const users = defineController({
      prefix: '/users',
      routes: [
        route({
          method: 'GET',
          path: '/',
          schema: { query: Paging },
          handler: (ctx) => ({ page: ctx.input.query.page }),
        }),
        route({
          method: 'PUT',
          path: '/:id',
          schema: { params: UserId, body: CreateUser },
          handler: (ctx) => ({
            raw: ctx.params.id,
            id: ctx.input.params.id,
            name: ctx.input.body.name,
          }),
        }),
      ],
    });
    const url = await serve(createAvi().register({ controllers: [users] }));

    expect(await (await fetch(`${url}/users?page=3`)).json()).toEqual({ page: 3 });
    expect(await (await fetch(`${url}/users`)).json()).toEqual({ page: 1 });
    expect(await (await fetch(`${url}/users/7`, json('PUT', { name: 'Ada' }))).json()).toEqual({
      raw: '7',
      id: 7,
      name: 'Ada',
    });
  });

  it('answers 400 with every issue', async () => {
    const users = defineController({
      prefix: '/users',
      routes: [
        route({
          method: 'PUT',
          path: '/:id',
          schema: { params: UserId, body: CreateUser },
          handler: () => 'never',
        }),
      ],
    });
    const url = await serve(createAvi().register({ controllers: [users] }));
    const res = await fetch(`${url}/users/abc`, json('PUT', { name: '' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: {
        issues: [
          { in: 'params', path: ['id'], message: 'id must be numeric' },
          { in: 'body', path: ['name'], message: 'name is required' },
        ],
      },
    });
  });

  it('runs validation after guards', async () => {
    const users = defineController({
      routes: [
        route({
          method: 'POST',
          path: '/users',
          guards: [() => false],
          schema: { body: CreateUser },
          handler: () => 'never',
        }),
      ],
    });
    const url = await serve(createAvi().register({ controllers: [users] }));
    expect((await fetch(`${url}/users`, json('POST', {}))).status).toBe(403);
  });

  it('filters responses through the response schema', async () => {
    const me = defineController({
      routes: [
        route({
          method: 'GET',
          path: '/me',
          schema: { response: PublicUser },
          handler: () => ({ id: 1, name: 'Ada', passwordHash: 'x' }),
        }),
      ],
    });
    const url = await serve(createAvi().register({ controllers: [me] }));
    expect(await (await fetch(`${url}/me`)).json()).toEqual({ id: 1, name: 'Ada' });
  });

  it('rejects a schema part that is not a Standard Schema at definition', () => {
    expect(() =>
      defineController({
        routes: [
          {
            method: 'POST',
            path: '/',
            schema: { body: { name: 'string' } as never },
            handler: () => 1,
          },
        ],
      }),
    ).toThrow('Route POST / schema.body is not a Standard Schema');
  });
});

describe('decorators with schemas', () => {
  it('validates and fills ctx.input', async () => {
    @Controller('/users')
    class Users {
      @Get('/:id', { schema: { params: UserId } })
      one(ctx: Context<{ params: { id: number } }, { id: string }>) {
        return { id: ctx.input.params.id, raw: ctx.params.id };
      }

      @Post('/', { schema: { body: CreateUser, response: PublicUser } })
      @UseGuards(() => true)
      create(ctx: Context<{ body: InferOutput<typeof CreateUser> }>) {
        return reply({ id: 2, name: ctx.input.body.name, secret: true }, { status: 201 });
      }
    }

    const url = await serve(createAvi().register({ controllers: [Users] }));
    expect(await (await fetch(`${url}/users/5`)).json()).toEqual({ id: 5, raw: '5' });
    expect((await fetch(`${url}/users/x`)).status).toBe(400);

    const created = await fetch(`${url}/users`, json('POST', { name: 'Grace' }));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: 2, name: 'Grace' });
    expect((await fetch(`${url}/users`, json('POST', { name: '' }))).status).toBe(400);
  });

  it('gives the same error body as the explicit API', async () => {
    @Controller('/d')
    class Decorated {
      @Post('/', { schema: { body: CreateUser } })
      create() {
        return 'ok';
      }
    }
    const explicit = defineController({
      prefix: '/e',
      routes: [
        route({ method: 'POST', path: '/', schema: { body: CreateUser }, handler: () => 'ok' }),
      ],
    });
    const url = await serve(createAvi().register({ controllers: [Decorated, explicit] }));
    const a = await (await fetch(`${url}/d`, json('POST', { name: '' }))).text();
    const b = await (await fetch(`${url}/e`, json('POST', { name: '' }))).text();
    expect(a).toBe(b);
  });

  it('rejects an invalid schema at decoration', () => {
    expect(() => Get('/', { schema: { query: 'nope' as never } })).toThrow(
      "@Get('/') schema.query is not a Standard Schema",
    );
  });
});
