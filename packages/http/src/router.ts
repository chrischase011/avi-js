import type { Context } from './context.js';
import { HTTP_METHODS, type HttpMethod } from './methods.js';

export type Handler = (ctx: Context) => unknown;

export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: Handler;
}

export type Params = Readonly<Record<string, string>>;

export type RouteMatch =
  | {
      readonly kind: 'found';
      readonly handler: Handler;
      readonly params: Params;
      /** The registered pattern, e.g. `/users/:id`. */
      readonly route: string;
    }
  /** The path exists, but not for this method. `allow` lists the methods that do. */
  | { readonly kind: 'method-not-allowed'; readonly allow: string }
  /** An `OPTIONS` request for a path with no explicit `OPTIONS` route. */
  | { readonly kind: 'options'; readonly allow: string }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'malformed' };

interface Route {
  readonly handler: Handler;
  readonly names: readonly string[];
  readonly pattern: string;
}

interface Node {
  readonly statics: Map<string, Node>;
  param: { readonly name: string; readonly node: Node } | undefined;
  wildcard: Node | undefined;
  readonly routes: Map<string, Route>;
}

const NOT_FOUND: RouteMatch = { kind: 'not-found' };
const MALFORMED: RouteMatch = { kind: 'malformed' };
const PARAM_NAME = /^[A-Za-z_$][\w$]*$/;

/**
 * Segment-trie router. Per segment, static beats `:param` beats a trailing `*`,
 * with backtracking when a more specific branch has no route for the request.
 */
export class Router {
  #definitions: RouteDefinition[] = [];
  #root: Node = createNode();
  #static = new Map<string, Map<string, RouteMatch>>();

  /** Adds all routes, or none if any of them is invalid or conflicts. */
  add(routes: readonly RouteDefinition[]): void {
    const definitions = [...this.#definitions, ...routes];
    const root = createNode();
    for (const route of definitions) insert(root, route);

    const fast = new Map<string, Map<string, RouteMatch>>();
    for (const { method, path, handler } of definitions) {
      const key = staticKey(path);
      if (key === undefined) continue;
      let byMethod = fast.get(key);
      if (!byMethod) fast.set(key, (byMethod = new Map<string, RouteMatch>()));
      byMethod.set(method, { kind: 'found', handler, params: NO_PARAMS, route: path });
    }

    this.#definitions = definitions;
    this.#root = root;
    this.#static = fast;
  }

  find(method: string, path: string): RouteMatch {
    return this.#findStatic(method, path) ?? this.#findDynamic(method, path);
  }

  // Fully static routes always win, so an exact hit can skip the trie. Static keys never
  // contain `%` or `//`, so encoded paths and empty segments miss and take the slow path.
  #findStatic(method: string, path: string): RouteMatch | undefined {
    const last = path.length - 1;
    const trailingSlash = last > 0 && path.charCodeAt(last) === 47;
    if (trailingSlash && path.charCodeAt(last - 1) === 47) return undefined;
    return this.#static.get(trailingSlash ? path.slice(0, last) : path)?.get(method);
  }

  #findDynamic(method: string, path: string): RouteMatch {
    const segments = splitPath(path);
    if (segments === undefined) return NOT_FOUND;
    if (segments === null) return MALFORMED;

    const values: string[] = [];
    let route = match(this.#root, segments, 0, values, (node) => node.routes.get(method));
    if (!route && method === 'HEAD') {
      route = match(this.#root, segments, 0, values, (node) => node.routes.get('GET'));
    }
    if (route)
      return {
        kind: 'found',
        handler: route.handler,
        params: toParams(route.names, values),
        route: route.pattern,
      };

    const methods = new Set<string>();
    collectMethods(this.#root, segments, 0, methods);
    if (methods.size === 0) return NOT_FOUND;

    const allow = allowHeader(methods);
    return method === 'OPTIONS'
      ? { kind: 'options', allow }
      : { kind: 'method-not-allowed', allow };
  }
}

function createNode(): Node {
  return { statics: new Map(), param: undefined, wildcard: undefined, routes: new Map() };
}

// Inputs are checked as unknown because JavaScript callers bypass the types.
function insert(root: Node, route: RouteDefinition): void {
  const { method, path, handler } = route as { method: unknown; path: unknown; handler: unknown };
  if (!HTTP_METHODS.includes(method as HttpMethod)) {
    throw new TypeError(`Unsupported HTTP method: ${String(method)}`);
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError(`Route path must start with "/": ${String(path)}`);
  }
  if (typeof handler !== 'function') {
    throw new TypeError(`Handler for ${method as string} ${path} must be a function`);
  }

  const segments = path === '/' ? [] : path.replace(/\/$/, '').slice(1).split('/');
  const names: string[] = [];
  let node = root;

  for (const [index, segment] of segments.entries()) {
    if (segment === '') throw new TypeError(`Route path has an empty segment: ${path}`);

    if (segment === '*') {
      if (index !== segments.length - 1) {
        throw new TypeError(`"*" must be the last segment: ${path}`);
      }
      names.push('*');
      node = node.wildcard ??= createNode();
    } else if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!PARAM_NAME.test(name)) throw new TypeError(`Invalid parameter name "${name}": ${path}`);
      if (names.includes(name)) throw new TypeError(`Duplicate parameter "${name}": ${path}`);
      if (node.param && node.param.name !== name) {
        throw new Error(
          `Conflicting parameter names ":${node.param.name}" and ":${name}" at the same position: ${path}`,
        );
      }
      names.push(name);
      node.param ??= { name, node: createNode() };
      node = node.param.node;
    } else {
      if (segment.includes('*')) throw new TypeError(`"*" must be a whole segment: ${path}`);
      const key = decodeStatic(segment, path);
      let next = node.statics.get(key);
      if (!next) node.statics.set(key, (next = createNode()));
      node = next;
    }
  }

  if (node.routes.has(route.method)) throw new Error(`Duplicate route: ${route.method} ${path}`);
  node.routes.set(route.method, { handler: route.handler, names, pattern: path });
}

function decodeStatic(segment: string, path: string): string {
  try {
    return segment.includes('%') ? decodeURIComponent(segment) : segment;
  } catch {
    throw new TypeError(`Malformed percent-encoding in route path: ${path}`);
  }
}

/** Splits a raw path into decoded segments. `undefined`: not a path. `null`: bad encoding. */
function splitPath(path: string): string[] | undefined | null {
  if (!path.startsWith('/')) return undefined;
  if (path.length === 1) return [];

  const end = path.endsWith('/') ? path.length - 1 : path.length;
  const segments = path.slice(1, end).split('/');
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string;
    if (segment.includes('%')) {
      try {
        segments[i] = decodeURIComponent(segment);
      } catch {
        return null;
      }
    }
  }
  return segments;
}

function match(
  node: Node,
  segments: readonly string[],
  index: number,
  values: string[],
  pick: (node: Node) => Route | undefined,
): Route | undefined {
  if (index === segments.length) {
    const route = pick(node);
    if (route) return route;
    if (node.wildcard) {
      const wild = pick(node.wildcard);
      if (wild) {
        values.push('');
        return wild;
      }
    }
    return undefined;
  }

  const segment = segments[index] as string;
  const child = node.statics.get(segment);
  if (child) {
    const route = match(child, segments, index + 1, values, pick);
    if (route) return route;
  }

  if (node.param && segment !== '') {
    values.push(segment);
    const route = match(node.param.node, segments, index + 1, values, pick);
    if (route) return route;
    values.pop();
  }

  if (node.wildcard && !hasEmptySegment(segments, index)) {
    const route = pick(node.wildcard);
    if (route) {
      values.push(segments.slice(index).join('/'));
      return route;
    }
  }
  return undefined;
}

function hasEmptySegment(segments: readonly string[], from: number): boolean {
  for (let i = from; i < segments.length; i++) if (segments[i] === '') return true;
  return false;
}

function collectMethods(
  node: Node,
  segments: readonly string[],
  index: number,
  methods: Set<string>,
): void {
  if (node.wildcard && !hasEmptySegment(segments, index)) {
    for (const method of node.wildcard.routes.keys()) methods.add(method);
  }
  if (index === segments.length) {
    for (const method of node.routes.keys()) methods.add(method);
    return;
  }
  const segment = segments[index] as string;
  const child = node.statics.get(segment);
  if (child) collectMethods(child, segments, index + 1, methods);
  if (node.param && segment !== '') collectMethods(node.param.node, segments, index + 1, methods);
}

function allowHeader(methods: Set<string>): string {
  if (methods.has('GET')) methods.add('HEAD');
  methods.add('OPTIONS');
  return HTTP_METHODS.filter((method) => methods.has(method)).join(', ');
}

function toParams(names: readonly string[], values: readonly string[]): Params {
  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let i = 0; i < names.length; i++) params[names[i] as string] = values[i] as string;
  return params;
}

const NO_PARAMS: Params = Object.freeze(Object.create(null) as Record<string, string>);

/** The lookup key of a route without parameters, as a request path would spell it. */
function staticKey(path: string): string | undefined {
  if (path.includes(':') || path.includes('*') || path.includes('%')) return undefined;
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
