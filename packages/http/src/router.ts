import type { Context } from './context.js';
import { HTTP_METHODS, type HttpMethod } from './methods.js';

export type Handler = (ctx: Context) => unknown;

export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: Handler;
}

/** Exact-match router. The segment trie replaces it in Phase 2. */
export class Router {
  readonly #routes = new Map<string, Map<string, Handler>>();

  /** Adds all routes, or none if any of them is invalid or a duplicate. */
  add(routes: readonly RouteDefinition[]): void {
    const seen = new Set<string>();
    for (const route of routes) {
      validate(route);
      const key = `${route.method} ${route.path}`;
      if (seen.has(key) || this.find(route.method, route.path)) {
        throw new Error(`Duplicate route: ${key}`);
      }
      seen.add(key);
    }

    for (const { method, path, handler } of routes) {
      let byPath = this.#routes.get(method);
      if (!byPath) this.#routes.set(method, (byPath = new Map<string, Handler>()));
      byPath.set(path, handler);
    }
  }

  find(method: string, path: string): Handler | undefined {
    return this.#routes.get(method)?.get(path);
  }
}

// Inputs are checked as unknown because JavaScript callers bypass the types.
function validate(route: RouteDefinition): void {
  const { method, path, handler } = route as { method: unknown; path: unknown; handler: unknown };
  if (!HTTP_METHODS.includes(method as HttpMethod)) {
    throw new TypeError(`Unsupported HTTP method: ${String(method)}`);
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError(`Route path must start with "/": ${String(path)}`);
  }
  if (path.includes(':') || path.includes('*')) {
    throw new TypeError(`Route parameters and wildcards are not supported yet: ${path}`);
  }
  if (typeof handler !== 'function') {
    throw new TypeError(`Handler for ${method as string} ${path} must be a function`);
  }
}
