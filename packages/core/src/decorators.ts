import type { Class, ResolveTokens, Scope, Token } from '@avi/di';
import type { Context, HttpMethod } from '@avi/http';
import { defineModule, type ModuleOptions } from './module.js';
import { controllerClasses, injectableScopes, moduleClasses, type RouteEntry } from './registry.js';

// TypeScript only fills in `context.metadata` when `Symbol.metadata` exists. Node.js does not
// define it yet, so install the well-known symbol the spec and other libraries use.
(Symbol as { metadata?: symbol }).metadata ??= Symbol.for('Symbol.metadata');

const ROUTES = Symbol('avi.routes');

type InjectOf<C> = C extends { inject: infer K extends readonly Token[] } ? K : [];

interface InjectMismatch {
  readonly 'static inject must list the constructor parameter types in order, declared `as const`': never;
}

/** Resolves to `unknown` when `static inject` fits the constructor, else to an error type. */
export type CheckInject<C extends Class> =
  ResolveTokens<InjectOf<C>> extends ConstructorParameters<C> ? unknown : InjectMismatch;

type Method = (ctx: Context) => unknown;

export function Controller(prefix = '/') {
  if (typeof prefix !== 'string') throw usage('@Controller');
  if (!prefix.startsWith('/'))
    throw new TypeError(`Controller prefix must start with "/": ${prefix}`);
  return <C extends Class & CheckInject<C>>(value: C, context: ClassDecoratorContext<C>): void => {
    expectKind(context, 'class', '@Controller');
    controllerClasses.set(value, { prefix, routes: collectRoutes(context.metadata) });
  };
}

export function Injectable(options: { scope?: Scope } = {}) {
  if (typeof options !== 'object') throw usage('@Injectable');
  const { scope } = options;
  const given: unknown = scope;
  if (given !== undefined && given !== 'singleton' && given !== 'transient') {
    throw new TypeError(`Invalid scope ${JSON.stringify(given)} in @Injectable`);
  }
  return <C extends Class & CheckInject<C>>(value: C, context: ClassDecoratorContext<C>): void => {
    expectKind(context, 'class', '@Injectable');
    if (scope) injectableScopes.set(value, scope);
  };
}

export function Module(options: ModuleOptions = {}) {
  if (typeof options !== 'object') throw usage('@Module');
  return <C extends Class>(value: C, context: ClassDecoratorContext<C>): void => {
    expectKind(context, 'class', '@Module');
    moduleClasses.set(value, defineModule({ name: String(context.name), ...options }));
  };
}

function routeDecorator(method: HttpMethod) {
  const label = `@${method.charAt(0)}${method.slice(1).toLowerCase()}`;
  return (path = '') => {
    if (typeof path !== 'string') throw usage(label);
    if (path !== '' && !path.startsWith('/')) {
      throw new TypeError(`${label} path must be empty or start with "/": ${path}`);
    }
    return <This, F extends Method>(
      _value: F,
      context: ClassMethodDecoratorContext<This, F>,
    ): void => {
      expectKind(context, 'method', label);
      const name = String(context.name);
      if (context.static) throw new TypeError(`${label} cannot decorate static method ${name}`);
      ownRoutes(context.metadata).push({
        method,
        path,
        name,
        get: (instance) => context.access.get(instance as This),
      });
    };
  };
}

export const Get = routeDecorator('GET');
export const Post = routeDecorator('POST');
export const Put = routeDecorator('PUT');
export const Patch = routeDecorator('PATCH');
export const Delete = routeDecorator('DELETE');
export const Head = routeDecorator('HEAD');
export const Options = routeDecorator('OPTIONS');

function ownRoutes(metadata: DecoratorMetadata): RouteEntry[] {
  const record = metadata as Record<symbol, RouteEntry[] | undefined>;
  if (!Object.hasOwn(record, ROUTES)) record[ROUTES] = [];
  return record[ROUTES] as RouteEntry[];
}

// Base class routes first, so inherited routes keep their declaration order.
function collectRoutes(metadata: DecoratorMetadata | undefined): RouteEntry[] {
  const chain: RouteEntry[][] = [];
  for (
    let m = metadata as object | null | undefined;
    m;
    m = Object.getPrototypeOf(m) as object | null
  ) {
    if (Object.hasOwn(m, ROUTES))
      chain.unshift((m as Record<symbol, RouteEntry[]>)[ROUTES] as RouteEntry[]);
  }
  return chain.flat();
}

function expectKind(context: unknown, kind: string, label: string): void {
  if (typeof context !== 'object' || context === null || !('kind' in context)) {
    throw new TypeError(
      `${label}: Avi.js uses standard decorators. Turn off "experimentalDecorators" in tsconfig.json.`,
    );
  }
  if (context.kind !== kind) throw new TypeError(`${label} can only decorate a ${kind}`);
}

function usage(label: string): TypeError {
  return new TypeError(`${label} must be called: write ${label}(), not ${label}`);
}
