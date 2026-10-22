import * as v from 'valibot';
import { describe, expectTypeOf, it } from 'vitest';
import {
  Controller,
  Post,
  defineController,
  route,
  type Context,
  type NoInput,
  type PathParams,
} from '../src/index.js';

const CreateUser = v.object({ name: v.string() });
const PublicUser = v.object({ id: v.number() });

describe('PathParams', () => {
  it('extracts named parameters and the catch-all', () => {
    expectTypeOf<PathParams<'/users/:id/posts/:postId'>>().toEqualTypeOf<{
      readonly id: string;
      readonly postId: string;
    }>();
    expectTypeOf<PathParams<'/files/*'>>().toEqualTypeOf<{ readonly '*': string }>();
    // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- asserting it is empty
    expectTypeOf<keyof PathParams<'/health'>>().toEqualTypeOf<never>();
  });
});

describe('route()', () => {
  it('types ctx.params from the path', () => {
    route({
      method: 'GET',
      path: '/users/:id',
      handler: (ctx) => {
        expectTypeOf(ctx.params.id).toEqualTypeOf<string>();
        // @ts-expect-error not a parameter of this path
        return ctx.params.other; // eslint-disable-line @typescript-eslint/no-unsafe-return -- the error is the point
      },
    });
  });

  it('types ctx.input from the schema output', () => {
    route({
      method: 'POST',
      path: '/users',
      schema: {
        body: CreateUser,
        query: v.object({ page: v.pipe(v.string(), v.transform(Number)) }),
      },
      handler: (ctx) => {
        expectTypeOf(ctx.input.body).toEqualTypeOf<{ name: string }>();
        expectTypeOf(ctx.input.query.page).toEqualTypeOf<number>();
        // @ts-expect-error no params schema
        return ctx.input.params; // eslint-disable-line @typescript-eslint/no-unsafe-return -- the error is the point
      },
    });
  });

  it('leaves ctx.input empty without a schema', () => {
    route({
      method: 'GET',
      path: '/',
      handler: (ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- asserting it is empty
        expectTypeOf(ctx.input).toEqualTypeOf<Readonly<NoInput>>();
        return 'ok';
      },
    });
  });

  it('checks the handler result against the response schema', () => {
    route({
      method: 'GET',
      path: '/me',
      schema: { response: PublicUser },
      handler: () => ({ id: 1 }),
    });
    route({
      method: 'GET',
      path: '/me',
      schema: { response: PublicUser },
      // @ts-expect-error id must be a number
      handler: () => ({ id: 'one' }),
    });
  });

  it('fits in a controller routes list', () => {
    defineController({
      routes: [route({ method: 'GET', path: '/:id', handler: (ctx) => ctx.params.id })],
    });
  });
});

describe('route decorators with schemas', () => {
  it('accept a matching ctx annotation or a plain Context', () => {
    @Controller()
    class Users {
      @Post('/:id', { schema: { body: CreateUser } })
      typed(ctx: Context<{ body: { name: string } }, { id: string }>) {
        return ctx.input.body.name + ctx.params.id;
      }

      @Post('/plain', { schema: { body: CreateUser } })
      plain(ctx: Context) {
        return ctx.path;
      }
    }
    expectTypeOf(Users).not.toBeNever();
  });

  it('reject an annotation that does not match the schema', () => {
    @Controller()
    class Users {
      // @ts-expect-error body is { name: string }, not a number
      @Post('/', { schema: { body: CreateUser } })
      create(ctx: Context<{ body: number }>) {
        return ctx.input.body;
      }
    }
    expectTypeOf(Users).not.toBeNever();
  });
});
