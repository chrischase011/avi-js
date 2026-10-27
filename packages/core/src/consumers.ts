import { resolveInjects, type Container, type Token } from '@avijs/di';
import type { AviModule } from './module.js';
import { isClass, type GuardClass, type GuardRef, type MiddlewareRef } from './pipeline.js';

/**
 * Checks that controllers, middleware and guard classes can see what they inject, and that
 * middleware and guards do not need a request scope.
 */
export function checkConsumers(container: Container): void {
  for (const module of container.modules as AviModule[]) {
    const checkRef = (ref: MiddlewareRef | GuardRef, label: string) => {
      if (!isClass(ref)) return;
      const cls = ref as GuardClass;
      const inject = injectOf(cls);
      container.check(module, inject, `${label} ${cls.name}`);
      if (container.needsRequest(module, inject)) {
        throw new Error(
          `${label} ${cls.name} depends on a request-scoped provider. Middleware and guards are created once; read per-request data from ctx or ctx.state instead.`,
        );
      }
    };
    for (const ref of [...module.middleware, ...module.guards]) checkRef(ref, module.name);
    for (const controller of module.controllers) {
      const label = `${module.name} controller ${controller.prefix}`;
      container.check(module, controller.inject, label);
      for (const ref of [...controller.middleware, ...controller.guards]) checkRef(ref, label);
    }
  }
}

export function injectOf(cls: { readonly inject?: readonly Token[] }): readonly Token[] {
  resolveInjects();
  return cls.inject ?? [];
}
