import type { Context } from './context.js';
import { HttpError } from './errors.js';
import type { Handler } from './router.js';

export type Next = () => Promise<unknown>;

/** Runs around the handler. `await next()` returns the handler's result. */
export type Middleware = (ctx: Context, next: Next) => unknown;

/** Return `true` to let the request through. Anything else gives a 403. */
export type Guard = (ctx: Context) => boolean | Promise<boolean>;

/**
 * Builds one handler running middleware (in order, onion-style), then guards, then `handler`.
 * Without middleware or guards, returns `handler` unchanged.
 */
export function compose(
  middleware: readonly Middleware[],
  guards: readonly Guard[],
  handler: Handler,
): Handler {
  if (middleware.length === 0 && guards.length === 0) return handler;

  const inner = guards.length === 0 ? handler : guarded(guards, handler);
  if (middleware.length === 0) return inner;

  return (ctx) => {
    let called = -1;
    const dispatch = async (i: number): Promise<unknown> => {
      if (i <= called) throw new Error('next() was called more than once');
      called = i;
      const current = middleware[i];
      return await (current ? current(ctx, () => dispatch(i + 1)) : inner(ctx));
    };
    return dispatch(0);
  };
}

function guarded(guards: readonly Guard[], handler: Handler): Handler {
  return async (ctx) => {
    for (const guard of guards) {
      const allowed: unknown = await guard(ctx);
      if (allowed !== true) throw new HttpError(403);
    }
    return handler(ctx);
  };
}
