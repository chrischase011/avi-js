import type { RouteDefinition } from '@avi/http';

export interface ControllerOptions {
  /** Path prefix for every route. Default: `/`. */
  prefix?: string;
  routes: readonly RouteDefinition[];
}

export interface ControllerDefinition {
  readonly prefix: string;
  readonly routes: readonly RouteDefinition[];
}

export function defineController(options: ControllerOptions): ControllerDefinition {
  const prefix = options.prefix ?? '/';
  if (!prefix.startsWith('/')) {
    throw new TypeError(`Controller prefix must start with "/": ${prefix}`);
  }
  for (const route of options.routes) {
    if (route.path !== '' && !route.path.startsWith('/')) {
      throw new TypeError(`Route path must be empty or start with "/": ${route.path}`);
    }
  }
  return Object.freeze({ prefix, routes: Object.freeze([...options.routes]) });
}

/** Joins a prefix and a route path, collapsing repeated slashes and dropping a trailing one. */
export function joinPath(prefix: string, path: string): string {
  const joined = `${prefix}/${path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}
