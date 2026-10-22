import { HttpError, REQUEST, createToken, type Context, type Provider } from '@avijs/core';
import type { User } from './users.js';

/** The signed-in user, resolved once per request. */
export const CURRENT_USER = createToken<User>('CurrentUser');

export const currentUserProvider: Provider<User> = {
  provide: CURRENT_USER,
  useFactory: (ctx: Context) => {
    if (!ctx.state.user) throw new HttpError(401, 'Sign in first');
    return ctx.state.user;
  },
  inject: [REQUEST],
  scope: 'request',
};
