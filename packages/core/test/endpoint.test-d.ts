import * as v from 'valibot';
import { describe, expectTypeOf, it } from 'vitest';
import {
  Controller,
  Get,
  Injectable,
  Post,
  createToken,
  defineController,
  reply,
  route,
  sse,
  type Context,
  type Jsonify,
  type MethodEndpoint,
  type RouteContext,
  type RouteEndpoint,
} from '../src/index.js';

describe('Jsonify', () => {
  it('matches what JSON.stringify produces', () => {
    interface Row {
      id: number;
      at: Date;
      note?: string;
      maybe: string | undefined;
      run: () => void;
      tags: (string | undefined)[];
      nested: { big: bigint; ok: boolean };
    }
    expectTypeOf<Jsonify<Row>>().toEqualTypeOf<{
      id: number;
      at: string;
      note?: string;
      maybe?: string;
      tags: (string | null)[];
      nested: { ok: boolean };
    }>();
    expectTypeOf<Jsonify<unknown>>().toEqualTypeOf<unknown>();
    expectTypeOf<Jsonify<[number, Date]>>().toEqualTypeOf<[number, string]>();
  });
});

const ListQuery = v.object({ page: v.optional(v.pipe(v.string(), v.transform(Number))) });
const CreateUser = v.object({ name: v.string() });
const User = v.object({ id: v.number(), name: v.string(), createdAt: v.date() });

const list = { query: ListQuery } as const;
const create = { body: CreateUser, response: User } as const;

@Injectable()
class UsersService {
  all() {
    return [{ id: 1, name: 'Shiela', secret: Symbol('x') }];
  }
}

@Controller('/users')
class UsersController {
  static inject = [UsersService] as const;
  constructor(readonly users: UsersService) {}

  @Get('/', { schema: list })
  findAll(ctx: RouteContext<typeof list>) {
    expectTypeOf(ctx.input.query.page).toEqualTypeOf<number | undefined>();
    return this.users.all();
  }

  @Get('/:id')
  findOne(ctx: Context) {
    return Promise.resolve(reply({ id: Number(ctx.params['id']) }, { status: 200 }));
  }

  @Post('/', { schema: create })
  create(ctx: RouteContext<typeof create>) {
    return reply({ id: 1, name: ctx.input.body.name, createdAt: new Date() }, { status: 201 });
  }

  @Get('/events')
  events(ctx: Context) {
    return sse(ctx, function* () {
      yield 'hi';
    });
  }

  @Post('/ping')
  ping() {
    return undefined;
  }
}

describe('MethodEndpoint', () => {
  it('takes the request from schema inputs and the response from the handler', () => {
    type E = MethodEndpoint<'/users', UsersController['findAll']>;
    expectTypeOf<keyof E['params']>().toEqualTypeOf<never>();
    // The client sends what the schema accepts, before transforms.
    expectTypeOf<E['query']>().toEqualTypeOf<{ page?: string | undefined }>();
    expectTypeOf<E['body']>().toEqualTypeOf<undefined>();
    expectTypeOf<E['response']>().toEqualTypeOf<{ id: number; name: string }[]>();
  });

  it('reads params from the path and unwraps reply() and promises', () => {
    type E = MethodEndpoint<'/users/:id', UsersController['findOne']>;
    expectTypeOf<E['params']>().toEqualTypeOf<Readonly<Record<'id', string>>>();
    expectTypeOf<E['response']>().toEqualTypeOf<{ id: number }>();
  });

  it('prefers the response schema output', () => {
    type E = MethodEndpoint<'/users', UsersController['create']>;
    expectTypeOf<E['body']>().toEqualTypeOf<{ name: string }>();
    expectTypeOf<E['response']>().toEqualTypeOf<{ id: number; name: string; createdAt: string }>();
  });

  it('gives streams as a Response and nothing as undefined', () => {
    expectTypeOf<
      MethodEndpoint<'/users/events', UsersController['events']>['response']
    >().toEqualTypeOf<Response>();
    expectTypeOf<
      MethodEndpoint<'/users/ping', UsersController['ping']>['response']
    >().toEqualTypeOf<undefined>();
  });
});

const Store = createToken<{ get(id: string): { id: string; at: Date } }>('Store');

export const plain = defineController({
  prefix: '/plain',
  routes: [
    { method: 'GET', path: '/', handler: () => ({ ok: true }) },
    { method: 'POST', path: '/:id', handler: (ctx) => ctx.params['id'] ?? '' },
  ],
});

export const typed = defineController({
  prefix: '/items',
  inject: [Store],
  routes: (store) => [
    route({
      method: 'GET',
      path: '/:id',
      handler: (ctx) => store.get(ctx.params.id),
    }),
    route({
      method: 'POST',
      path: '/',
      schema: create,
      handler: (ctx) => ({ id: 2, name: ctx.input.body.name, createdAt: new Date() }),
    }),
  ],
});

describe('RouteEndpoint', () => {
  it('types plain routes by position', () => {
    expectTypeOf<RouteEndpoint<'/plain', typeof plain, 0>['response']>().toEqualTypeOf<{
      ok: boolean;
    }>();
    type Second = RouteEndpoint<'/plain/:id', typeof plain, 1>;
    expectTypeOf<Second['params']>().toEqualTypeOf<Readonly<Record<'id', string>>>();
    expectTypeOf<Second['response']>().toEqualTypeOf<string>();
  });

  it('types route() routes from a routes factory', () => {
    expectTypeOf<RouteEndpoint<'/items/:id', typeof typed, 0>['response']>().toEqualTypeOf<{
      id: string;
      at: string;
    }>();
    type Create = RouteEndpoint<'/items', typeof typed, 1>;
    expectTypeOf<Create['body']>().toEqualTypeOf<{ name: string }>();
    expectTypeOf<Create['response']>().toEqualTypeOf<{
      id: number;
      name: string;
      createdAt: string;
    }>();
  });
});
