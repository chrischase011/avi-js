import type { Container, Token } from '@avi/di';
import type { AviModule } from './module.js';
import { isClass, type GuardClass } from './pipeline.js';

/** Checks that controllers, middleware and guard classes can see what they inject. */
export function checkConsumers(container: Container): void {
  for (const module of container.modules as AviModule[]) {
    for (const ref of [...module.middleware, ...module.guards]) {
      if (isClass(ref)) {
        container.check(module, injectOf(ref as GuardClass), `${module.name} ${ref.name}`);
      }
    }
    for (const controller of module.controllers) {
      const label = `${module.name} controller ${controller.prefix}`;
      container.check(module, controller.inject, label);
      for (const ref of [...controller.middleware, ...controller.guards]) {
        if (isClass(ref)) {
          container.check(module, injectOf(ref as GuardClass), `${label} ${ref.name}`);
        }
      }
    }
  }
}

export function injectOf(cls: { readonly inject?: readonly Token[] }): readonly Token[] {
  return cls.inject ?? [];
}
