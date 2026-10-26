import { expectTypeOf, it } from 'vitest';
import { createToken, defineController, defineHook, type Context } from '@avijs/core';

interface User {
  id: string;
}

declare module '@avijs/core' {
  interface AviState {
    user?: User;
  }
}

it('types ctx.state through AviState', () => {
  defineController({
    routes: [
      {
        method: 'GET',
        path: '/',
        handler: (ctx: Context) => {
          expectTypeOf(ctx.state.user).toEqualTypeOf<User | undefined>();
          expectTypeOf(ctx.state['other']).toEqualTypeOf<unknown>();
          return ctx.state.user?.id;
        },
      },
    ],
  });
});

it('types ctx.need without undefined, for declared keys only', () => {
  defineController({
    routes: [
      {
        method: 'GET',
        path: '/',
        handler: (ctx: Context) => {
          expectTypeOf(ctx.need('user')).toEqualTypeOf<User>();
          // @ts-expect-error only keys declared on AviState
          ctx.need('other');
          return ctx.need('user').id;
        },
      },
    ],
  });
});

it('types defineHook from inject', () => {
  const Origin = createToken<string>('Origin');
  defineHook({
    inject: [Origin],
    create: (origin) => {
      expectTypeOf(origin).toEqualTypeOf<string>();
      return () => undefined;
    },
  });
  defineHook({
    inject: [Origin],
    // @ts-expect-error the dependency is a string
    create: (origin: number) => () => origin,
  });
});
