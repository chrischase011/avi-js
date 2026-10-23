import { HttpError, type Context, type Guard } from '@avijs/core';
import { TokenService } from './tokens.js';
import type { Role } from './users.js';

/** Requires `Authorization: Bearer <token>` and puts the user on `ctx.state.user`. */
export class AuthGuard {
  static inject = [TokenService] as const;

  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: Context): boolean {
    const header = ctx.headers.authorization;
    const user = header?.startsWith('Bearer ') ? this.tokens.verify(header.slice(7)) : undefined;
    if (!user) {
      throw new HttpError(401, 'Sign in first', { headers: { 'www-authenticate': 'Bearer' } });
    }
    ctx.state.user = user;
    return true;
  }
}

/** Lets the request through only for users with one of `roles`. Use after AuthGuard. */
export function requireRole(...roles: Role[]): Guard {
  return (ctx) => roles.some((role) => ctx.state.user?.role === role);
}
