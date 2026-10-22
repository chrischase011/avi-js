import type { Token } from '@avi/di';
import type { Context, Guard, Middleware, Next, RouteDefinition } from '@avi/http';

/** Middleware with dependencies. Built once per app with its `static inject`. */
export interface MiddlewareClass {
  new (...args: never[]): { use(ctx: Context, next: Next): unknown };
  readonly inject?: readonly Token[];
}

/** A guard with dependencies. Built once per app with its `static inject`. */
export interface GuardClass {
  new (...args: never[]): { canActivate(ctx: Context): boolean | Promise<boolean> };
  readonly inject?: readonly Token[];
}

export type MiddlewareRef = Middleware | MiddlewareClass;
export type GuardRef = Guard | GuardClass;

/** A route as written in a controller, with optional route-level middleware and guards. */
export interface Route extends RouteDefinition {
  readonly middleware?: readonly MiddlewareRef[];
  readonly guards?: readonly GuardRef[];
}

export function isClass(value: unknown): boolean {
  return typeof value === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

/** Validates a list of middleware or guard refs. `method` is `use` or `canActivate`. */
export function checkRefs<T>(
  refs: readonly T[] | undefined,
  method: string,
  where: string,
): readonly T[] {
  if (refs === undefined) return [];
  const list: unknown = refs;
  if (!Array.isArray(list)) throw new TypeError(`${where} must be an array`);
  (list as unknown[]).forEach((ref, i) => {
    if (typeof ref !== 'function') {
      throw new TypeError(
        `${where}[${String(i)}] must be a function or a class${ref === undefined ? ' (is there a circular import?)' : ''}`,
      );
    }
    const fn = ref as { name: string; prototype?: Record<string, unknown> };
    if (isClass(fn) && typeof fn.prototype?.[method] !== 'function') {
      throw new TypeError(`${fn.name} in ${where} needs a ${method}() method`);
    }
  });
  return Object.freeze([...refs]);
}
