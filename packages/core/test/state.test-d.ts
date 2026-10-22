import { expectTypeOf, it } from 'vitest';
import { defineController, type Context } from '@avijs/core';

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
