import type { Token } from '@avijs/di';
import type {
  Context,
  Guard,
  HttpMethod,
  Middleware,
  Next,
  NoInput,
  RouteDefinition,
} from '@avijs/http';
import type { InputOf, PathParams, ResultOf, RouteSchema } from '@avijs/validation';

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

/** A route as written in a controller, with optional middleware, guards and schemas. */
export interface Route extends RouteDefinition {
  readonly middleware?: readonly MiddlewareRef[];
  readonly guards?: readonly GuardRef[];
  readonly schema?: RouteSchema;
  readonly openapi?: RouteDocs;
}

/** Documentation for OpenAPI. It has no effect on how the route runs. */
export interface RouteDocs {
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly operationId?: string;
  readonly deprecated?: boolean;
}

/**
 * The context of a handler for route schema `S`, with `ctx.input` typed from it. Declare the
 * schema once and use it in both places: `@Post('/', { schema: create })` and
 * `create(ctx: RouteContext<typeof create>)`.
 */
export type RouteContext<S extends RouteSchema> = Context<InputOf<S>>;

/** A route whose handler is typed from its path and schema. Created with `route()`. */
export interface TypedRoute<P extends string, S extends RouteSchema> {
  readonly method: HttpMethod;
  readonly path: P;
  readonly schema?: S;
  readonly openapi?: RouteDocs;
  readonly middleware?: readonly MiddlewareRef[];
  readonly guards?: readonly GuardRef[];
  readonly handler: (ctx: Context<InputOf<S>, PathParams<P>>) => ResultOf<S>;
}

/**
 * Declares a route with typed `ctx.params` (from the path) and `ctx.input` (from the schema).
 * At runtime it returns the definition unchanged.
 */
export function route<const P extends string, S extends RouteSchema = NoInput>(
  definition: TypedRoute<P, S>,
): Route {
  return definition as unknown as Route;
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
