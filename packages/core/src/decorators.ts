import type { Class, ResolveTokens, Scope, Token } from '@avijs/di';
import type { Context, HttpMethod, NoInput } from '@avijs/http';
import {
  checkRouteSchema,
  type InputOf,
  type PathParams,
  type RouteSchema,
} from '@avijs/validation';
import { defineModule, type ModuleOptions } from './module.js';
import { checkRefs, type GuardRef, type MiddlewareRef, type RouteDocs } from './pipeline.js';
import {
  GUARDS,
  METHOD_GUARDS,
  METHOD_MIDDLEWARE,
  MIDDLEWARE,
  ROUTES,
  controllerClasses,
  injectableScopes,
  moduleClasses,
  ownList,
  ownMethodList,
  type RouteEntry,
} from './registry.js';

// TypeScript only fills in `context.metadata` when `Symbol.metadata` exists. Node.js does not
// define it yet, so install the well-known symbol the spec and other libraries use.
(Symbol as { metadata?: symbol }).metadata ??= Symbol.for('Symbol.metadata');

type InjectOf<C> = C extends { inject: infer K extends readonly Token[] } ? K : [];

interface InjectMismatch {
  readonly 'static inject must list the constructor parameter types in order, declared `as const`': never;
}

/** Resolves to `unknown` when `static inject` fits the constructor, else to an error type. */
export type CheckInject<C extends Class> =
  ResolveTokens<InjectOf<C>> extends ConstructorParameters<C> ? unknown : InjectMismatch;

export function Controller(prefix = '/') {
  if (typeof prefix !== 'string') throw usage('@Controller');
  if (!prefix.startsWith('/'))
    throw new TypeError(`Controller prefix must start with "/": ${prefix}`);
  return <C extends Class & CheckInject<C>>(value: C, context: ClassDecoratorContext<C>): void => {
    expectKind(context, 'class', '@Controller');
    controllerClasses.set(value, { prefix, metadata: context.metadata });
  };
}

/** Adds middleware to every route of a controller class, or to one route method. */
export function UseMiddleware(...middleware: MiddlewareRef[]) {
  const refs = checkRefs(middleware, 'use', '@UseMiddleware');
  return (_value: unknown, context: ClassDecoratorContext | ClassMethodDecoratorContext): void => {
    attach(context, '@UseMiddleware', MIDDLEWARE, METHOD_MIDDLEWARE, refs);
  };
}

/** Adds guards to every route of a controller class, or to one route method. */
export function UseGuards(...guards: GuardRef[]) {
  const refs = checkRefs(guards, 'canActivate', '@UseGuards');
  return (_value: unknown, context: ClassDecoratorContext | ClassMethodDecoratorContext): void => {
    attach(context, '@UseGuards', GUARDS, METHOD_GUARDS, refs);
  };
}

function attach(
  context: unknown,
  label: string,
  classKey: symbol,
  methodKey: symbol,
  refs: readonly unknown[],
): void {
  expectKind(context, ['class', 'method'], label);
  const ctx = context as ClassDecoratorContext | ClassMethodDecoratorContext;
  if (ctx.kind === 'class') {
    ownList(ctx.metadata, classKey).push(...refs);
    return;
  }
  if (ctx.static) throw new TypeError(`${label} cannot decorate static method ${String(ctx.name)}`);
  ownMethodList(ctx.metadata, methodKey, String(ctx.name)).push(...refs);
}

export function Injectable(options: { scope?: Scope } = {}) {
  if (typeof options !== 'object') throw usage('@Injectable');
  const { scope } = options;
  const given: unknown = scope;
  if (
    given !== undefined &&
    given !== 'singleton' &&
    given !== 'transient' &&
    given !== 'request'
  ) {
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
  return <const P extends string = '', S extends RouteSchema = NoInput>(
    path?: P,
    options: { schema?: S; openapi?: RouteDocs } = {},
  ) => {
    const routePath: string = path ?? '';
    if (typeof routePath !== 'string') throw usage(label);
    if (routePath !== '' && !routePath.startsWith('/')) {
      throw new TypeError(`${label} path must be empty or start with "/": ${routePath}`);
    }
    const schema = checkRouteSchema(options.schema, `${label}('${routePath}')`);
    return <This, F extends (this: This, ctx: Context<InputOf<S>, PathParams<P>>) => unknown>(
      _value: F,
      context: ClassMethodDecoratorContext<This, F>,
    ): void => {
      expectKind(context, 'method', label);
      const name = String(context.name);
      if (context.static) throw new TypeError(`${label} cannot decorate static method ${name}`);
      ownList<RouteEntry>(context.metadata, ROUTES).push({
        method,
        path: routePath,
        name,
        schema,
        openapi: options.openapi,
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

function expectKind(context: unknown, kind: string | string[], label: string): void {
  if (typeof context !== 'object' || context === null || !('kind' in context)) {
    throw new TypeError(
      `${label}: Avi.js uses standard decorators. Turn off "experimentalDecorators" in tsconfig.json.`,
    );
  }
  const kinds = Array.isArray(kind) ? kind : [kind];
  if (!kinds.includes(context.kind as string)) {
    throw new TypeError(`${label} can only decorate a ${kinds.join(' or ')}`);
  }
}

function usage(label: string): TypeError {
  return new TypeError(`${label} must be called: write ${label}(), not ${label}`);
}
