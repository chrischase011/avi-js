import type { ResolveTokens, Token } from '@avi/di';
import { checkRouteSchema } from '@avi/validation';
import { checkRefs, type GuardRef, type MiddlewareRef, type Route } from './pipeline.js';

export interface ControllerOptions<K extends readonly Token[] = []> {
  /** Path prefix for every route. Default: `/`. */
  prefix?: string;
  /** Dependencies passed to `routes`, in order. */
  inject?: K;
  /** Runs for every route in this controller, after app and module middleware. */
  middleware?: readonly MiddlewareRef[];
  /** Checked for every route in this controller, after app and module guards. */
  guards?: readonly GuardRef[];
  routes: readonly Route[] | ((...deps: ResolveTokens<K>) => readonly Route[]);
}

/** The normalized shape both controller styles produce. */
export interface ControllerDefinition {
  readonly prefix: string;
  readonly inject: readonly Token[];
  readonly middleware: readonly MiddlewareRef[];
  readonly guards: readonly GuardRef[];
  createRoutes(deps: readonly unknown[]): readonly Route[];
}

export function defineController<const K extends readonly Token[] = []>(
  options: ControllerOptions<K>,
): ControllerDefinition {
  const prefix = options.prefix ?? '/';
  if (!prefix.startsWith('/')) {
    throw new TypeError(`Controller prefix must start with "/": ${prefix}`);
  }
  const inject: readonly Token[] = Object.freeze([...(options.inject ?? [])]);
  const middleware = checkRefs(options.middleware, 'use', `Controller ${prefix} middleware`);
  const guards = checkRefs(options.guards, 'canActivate', `Controller ${prefix} guards`);
  const { routes } = options;

  if (typeof routes !== 'function') {
    const fixed = checkRoutes(routes);
    return Object.freeze({ prefix, inject, middleware, guards, createRoutes: () => fixed });
  }
  if (routes.length > inject.length) {
    throw new TypeError(
      `Controller ${prefix}: routes takes ${String(routes.length)} arguments but inject lists ${String(inject.length)}`,
    );
  }
  const factory = routes as (...deps: unknown[]) => readonly Route[];
  return Object.freeze({
    prefix,
    inject,
    middleware,
    guards,
    createRoutes: (deps: readonly unknown[]) => checkRoutes(factory(...deps)),
  });
}

export function checkRoutes(value: unknown): readonly Route[] {
  if (!Array.isArray(value)) throw new TypeError('Controller routes must be an array');
  const routes = value as readonly Route[];
  return Object.freeze(
    routes.map((route) => {
      if (route.path !== '' && !route.path.startsWith('/')) {
        throw new TypeError(`Route path must be empty or start with "/": ${route.path}`);
      }
      const where = `Route ${route.method} ${route.path}`;
      return Object.freeze({
        ...route,
        middleware: checkRefs(route.middleware, 'use', `${where} middleware`),
        guards: checkRefs(route.guards, 'canActivate', `${where} guards`),
        schema: checkRouteSchema(route.schema, where),
      });
    }),
  );
}

/** Joins a prefix and a route path, collapsing repeated slashes and dropping a trailing one. */
export function joinPath(prefix: string, path: string): string {
  const joined = `${prefix}/${path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}
