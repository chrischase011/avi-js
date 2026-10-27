// Decorated classes map to the same definitions the explicit API produces.
import { injectListError, resolveInjects, type Class, type Scope, type Token } from '@avijs/di';
import type { HttpMethod } from '@avijs/http';
import type { RouteSchema } from '@avijs/validation';
import type { ControllerDefinition } from './controller.js';
import type { AviModule } from './module.js';
import {
  checkRefs,
  type GuardRef,
  type MiddlewareRef,
  type Route,
  type RouteDocs,
} from './pipeline.js';

export interface RouteEntry {
  readonly method: HttpMethod;
  readonly path: string;
  readonly name: string;
  readonly schema: RouteSchema | undefined;
  readonly openapi: RouteDocs | undefined;
  readonly get: (instance: object) => unknown;
}

export interface ControllerMeta {
  readonly prefix: string;
  readonly metadata: DecoratorMetadata;
}

export const ROUTES = Symbol('avi.routes');
export const MIDDLEWARE = Symbol('avi.middleware');
export const GUARDS = Symbol('avi.guards');
export const METHOD_MIDDLEWARE = Symbol('avi.methodMiddleware');
export const METHOD_GUARDS = Symbol('avi.methodGuards');

export const controllerClasses = new WeakMap<Class, ControllerMeta>();
export const moduleClasses = new WeakMap<Class, AviModule>();
export const injectableScopes = new WeakMap<Class, Scope>();

type Store = Record<symbol, unknown>;

/** The array stored under `key` on this class's own metadata, created on first use. */
export function ownList<T>(metadata: DecoratorMetadata, key: symbol): T[] {
  const store = metadata as Store;
  if (!Object.hasOwn(store, key)) store[key] = [];
  return store[key] as T[];
}

/** Per-method arrays stored under `key` on this class's own metadata. */
export function ownMethodList<T>(metadata: DecoratorMetadata, key: symbol, name: string): T[] {
  const store = metadata as Store;
  if (!Object.hasOwn(store, key)) store[key] = Object.create(null) as Record<string, T[]>;
  const byName = store[key] as Record<string, T[]>;
  return (byName[name] ??= []);
}

// Walks the metadata prototype chain, base classes first.
function chain(metadata: DecoratorMetadata, key: symbol): unknown[] {
  const found: unknown[] = [];
  for (
    let m: object | null | undefined = metadata;
    m;
    m = Object.getPrototypeOf(m) as object | null
  ) {
    if (Object.hasOwn(m, key)) found.unshift((m as Store)[key]);
  }
  return found;
}

function collect<T>(metadata: DecoratorMetadata, key: symbol): T[] {
  return (chain(metadata, key) as T[][]).flat();
}

function collectForMethod<T>(metadata: DecoratorMetadata, key: symbol, name: string): T[] {
  return (chain(metadata, key) as Record<string, T[] | undefined>[]).flatMap((m) => m[name] ?? []);
}

export function controllerFromClass(cls: Class): ControllerDefinition {
  const meta = controllerClasses.get(cls);
  if (!meta) {
    throw new TypeError(`${cls.name || 'This class'} is not a controller: add @Controller()`);
  }

  // Read when the app starts, not when the module loads: a list from inject.gen.ts may not be
  // registered yet, since that file can be in an import cycle with this module.
  let inject: readonly Token[] | undefined;
  const injectList = (): readonly Token[] => {
    if (inject) return inject;
    resolveInjects();
    const given = (cls as { inject?: unknown }).inject;
    const list = given ?? [];
    if (!Array.isArray(list)) throw new TypeError(`${cls.name}.inject must be an array of tokens`);
    if (cls.length > list.length) {
      throw injectListError(cls.name, cls.length, given === undefined ? undefined : list);
    }
    return (inject = Object.freeze([...(list as Token[])]));
  };

  const { metadata } = meta;
  const entries = collect<RouteEntry>(metadata, ROUTES);
  const perRoute = entries.map((entry) => ({
    entry,
    middleware: checkRefs(
      collectForMethod<MiddlewareRef>(metadata, METHOD_MIDDLEWARE, entry.name),
      'use',
      `${cls.name}.${entry.name} middleware`,
    ),
    guards: checkRefs(
      collectForMethod<GuardRef>(metadata, METHOD_GUARDS, entry.name),
      'canActivate',
      `${cls.name}.${entry.name} guards`,
    ),
  }));

  const Ctor = cls as unknown as new (...args: unknown[]) => object;
  return Object.freeze({
    name: cls.name,
    prefix: meta.prefix,
    staticRoutes: Object.freeze(entries.map(({ method, path }) => ({ method, path }))),
    get inject() {
      return injectList();
    },
    middleware: checkRefs(
      collect<MiddlewareRef>(metadata, MIDDLEWARE),
      'use',
      `${cls.name} middleware`,
    ),
    guards: checkRefs(collect<GuardRef>(metadata, GUARDS), 'canActivate', `${cls.name} guards`),
    createRoutes(deps: readonly unknown[]): readonly Route[] {
      const instance = new Ctor(...deps);
      return Object.freeze(
        perRoute.map(({ entry, middleware, guards }) => {
          const method = entry.get(instance);
          if (typeof method !== 'function') {
            throw new TypeError(`${cls.name}.${entry.name} is not a method`);
          }
          return {
            method: entry.method,
            path: entry.path,
            handler: (method as (...args: unknown[]) => unknown).bind(instance),
            middleware,
            guards,
            schema: entry.schema,
            openapi: entry.openapi,
          };
        }),
      );
    },
  });
}
