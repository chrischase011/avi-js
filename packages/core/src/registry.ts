// Decorated classes map to the same definitions the explicit API produces.
import type { Class, Scope, Token } from '@avi/di';
import type { HttpMethod, RouteDefinition } from '@avi/http';
import type { ControllerDefinition } from './controller.js';
import type { AviModule } from './module.js';

export interface RouteEntry {
  readonly method: HttpMethod;
  readonly path: string;
  readonly name: string;
  readonly get: (instance: object) => unknown;
}

export interface ControllerMeta {
  readonly prefix: string;
  readonly routes: readonly RouteEntry[];
}

export const controllerClasses = new WeakMap<Class, ControllerMeta>();
export const moduleClasses = new WeakMap<Class, AviModule>();
export const injectableScopes = new WeakMap<Class, Scope>();

export function controllerFromClass(cls: Class): ControllerDefinition {
  const meta = controllerClasses.get(cls);
  if (!meta) {
    throw new TypeError(`${cls.name || 'This class'} is not a controller: add @Controller()`);
  }

  const inject = (cls as { inject?: unknown }).inject ?? [];
  if (!Array.isArray(inject)) throw new TypeError(`${cls.name}.inject must be an array of tokens`);
  if (cls.length > inject.length) {
    throw new TypeError(
      `${cls.name} takes ${String(cls.length)} constructor arguments but static inject lists ${String(inject.length)}`,
    );
  }

  const Ctor = cls as unknown as new (...args: unknown[]) => object;
  return Object.freeze({
    prefix: meta.prefix,
    inject: Object.freeze([...(inject as Token[])]),
    createRoutes(deps: readonly unknown[]): readonly RouteDefinition[] {
      const instance = new Ctor(...deps);
      return Object.freeze(
        meta.routes.map((route) => {
          const method = route.get(instance);
          if (typeof method !== 'function') {
            throw new TypeError(`${cls.name}.${route.name} is not a method`);
          }
          return {
            method: route.method,
            path: route.path,
            handler: (method as (...args: unknown[]) => unknown).bind(instance),
          };
        }),
      );
    },
  });
}
