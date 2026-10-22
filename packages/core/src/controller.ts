import type { ResolveTokens, Token } from '@avi/di';
import type { RouteDefinition } from '@avi/http';

export interface ControllerOptions<K extends readonly Token[] = []> {
  /** Path prefix for every route. Default: `/`. */
  prefix?: string;
  /** Dependencies passed to `routes`, in order. */
  inject?: K;
  routes: readonly RouteDefinition[] | ((...deps: ResolveTokens<K>) => readonly RouteDefinition[]);
}

/** The normalized shape both controller styles produce. */
export interface ControllerDefinition {
  readonly prefix: string;
  readonly inject: readonly Token[];
  createRoutes(deps: readonly unknown[]): readonly RouteDefinition[];
}

export function defineController<const K extends readonly Token[] = []>(
  options: ControllerOptions<K>,
): ControllerDefinition {
  const prefix = options.prefix ?? '/';
  if (!prefix.startsWith('/')) {
    throw new TypeError(`Controller prefix must start with "/": ${prefix}`);
  }
  const inject: readonly Token[] = Object.freeze([...(options.inject ?? [])]);
  const { routes } = options;

  if (typeof routes !== 'function') {
    const fixed = checkRoutes(routes);
    return Object.freeze({ prefix, inject, createRoutes: () => fixed });
  }
  if (routes.length > inject.length) {
    throw new TypeError(
      `Controller ${prefix}: routes takes ${String(routes.length)} arguments but inject lists ${String(inject.length)}`,
    );
  }
  const factory = routes as (...deps: unknown[]) => readonly RouteDefinition[];
  return Object.freeze({
    prefix,
    inject,
    createRoutes: (deps: readonly unknown[]) => checkRoutes(factory(...deps)),
  });
}

function checkRoutes(value: unknown): readonly RouteDefinition[] {
  if (!Array.isArray(value)) throw new TypeError('Controller routes must be an array');
  const routes = value as readonly RouteDefinition[];
  for (const route of routes) {
    if (route.path !== '' && !route.path.startsWith('/')) {
      throw new TypeError(`Route path must be empty or start with "/": ${route.path}`);
    }
  }
  return Object.freeze([...routes]);
}

/** Joins a prefix and a route path, collapsing repeated slashes and dropping a trailing one. */
export function joinPath(prefix: string, path: string): string {
  const joined = `${prefix}/${path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}
