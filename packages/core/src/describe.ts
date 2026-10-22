import { Container, type ModuleDescription } from '@avi/di';
import { checkConsumers } from './consumers.js';
import type { HttpMethod } from '@avi/http';
import { joinPath, type StaticRoute } from './controller.js';
import {
  defineModule,
  toModule,
  type AviModule,
  type ModuleOptions,
  type ModuleRef,
} from './module.js';

export interface ControllerDescription {
  readonly name: string;
  readonly prefix: string;
  readonly routes: readonly StaticRoute[] | 'dynamic';
}

export interface ModuleSummary extends ModuleDescription {
  readonly prefix: string;
  readonly controllers: readonly ControllerDescription[];
}

export interface RouteSummary {
  readonly method: HttpMethod;
  readonly path: string;
  readonly module: string;
  readonly controller: string;
}

/** A deterministic, JSON-safe description of an app. Used as a build-time manifest. */
export interface AppDescription {
  readonly version: 1;
  readonly modules: readonly ModuleSummary[];
  /** Routes known without running any provider, sorted by path then method. */
  readonly routes: readonly RouteSummary[];
  /** Controllers whose routes only exist at runtime (a `routes` factory). */
  readonly dynamic: readonly string[];
}

/**
 * Describes the module graph and routes of `roots` without creating any provider. Throws the
 * same graph errors as `init()`, so it doubles as a build-time check.
 */
export function describeApp(...roots: (ModuleRef | ModuleOptions)[]): AppDescription {
  const modules = roots.map((root) => toModule(root) ?? defineModule(root as ModuleOptions));
  const container = new Container(modules);
  checkConsumers(container);
  return describeModules(container);
}

export function describeModules(container: Container): AppDescription {
  const definitions = container.modules as AviModule[];
  const graph = container.describe();
  const names = stableNames(graph.map((m) => m.name));

  const routes: RouteSummary[] = [];
  const dynamic: string[] = [];
  const summaries = definitions.map((module, i): ModuleSummary => {
    const base = graph[i] as ModuleDescription;
    const name = names.get(base.name) ?? base.name;
    const controllers = module.controllers.map((controller): ControllerDescription => {
      const prefix = joinPath(module.prefix, controller.prefix);
      if (controller.staticRoutes === 'dynamic') {
        dynamic.push(`${name} / ${controller.name}`);
      } else {
        for (const route of controller.staticRoutes) {
          routes.push({
            method: route.method,
            path: joinPath(prefix, route.path),
            module: name,
            controller: controller.name,
          });
        }
      }
      return { name: controller.name, prefix: controller.prefix, routes: controller.staticRoutes };
    });
    return {
      name,
      imports: base.imports.map((imported) => names.get(imported) ?? imported),
      providers: base.providers,
      exports: base.exports,
      prefix: module.prefix,
      controllers,
    };
  });

  routes.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
  return { version: 1, modules: summaries, routes, dynamic };
}

// Generated names depend on how many modules a process created; number them by position.
function stableNames(names: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  let next = 0;
  for (const name of names) {
    if (/^AnonymousModule\d+$/.test(name)) map.set(name, `(anonymous ${String(++next)})`);
  }
  return map;
}

/** The first JSON path where two descriptions differ, or `undefined` if they match. */
export function firstDifference(
  expected: unknown,
  actual: unknown,
  path = '$',
): string | undefined {
  if (Object.is(expected, actual)) return undefined;
  if (
    typeof expected !== 'object' ||
    typeof actual !== 'object' ||
    expected === null ||
    actual === null ||
    Array.isArray(expected) !== Array.isArray(actual)
  ) {
    return path;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    const found = firstDifference(
      (expected as Record<string, unknown>)[key],
      (actual as Record<string, unknown>)[key],
      Array.isArray(expected) ? `${path}[${key}]` : `${path}.${key}`,
    );
    if (found) return found;
  }
  return undefined;
}
