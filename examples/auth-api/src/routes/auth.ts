import { HttpError, defineController, route } from '@avijs/core';
import * as v from 'valibot';
import { TokenService } from '../auth/tokens.js';
import { UsersService } from '../auth/users.js';

const Login = v.object({ username: v.string(), password: v.string() });

export const authRoutes = defineController({
  prefix: '/auth',
  inject: [UsersService, TokenService],
  routes: (users, tokens) => [
    route({
      method: 'POST',
      path: '/login',
      schema: { body: Login },
      handler: (ctx) => {
        const user = users.verify(ctx.input.body.username, ctx.input.body.password);
        if (!user) throw new HttpError(401, 'Wrong username or password');
        return { token: tokens.sign(user), user };
      },
    }),
  ],
});
