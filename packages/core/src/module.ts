import type { Class, ModuleDefinition, Provider, Token } from '@avi/di';
import type { ControllerDefinition } from './controller.js';
import { controllerFromClass, injectableScopes, moduleClasses } from './registry.js';

/** A module from `defineModule`, or a class decorated with `@Module`. */
export type ModuleRef = AviModule | Class;

export interface ModuleOptions {
  /** Used in error messages. */
  name?: string;
  /** Prepended to this module's own controllers, e.g. `/api/v1`. Not inherited by imports. */
  prefix?: string;
  imports?: readonly ModuleRef[];
  providers?: readonly Provider[];
  /** `defineController` results or `@Controller` classes. */
  controllers?: readonly (ControllerDefinition | Class)[];
  /** Own providers, re-exported tokens, or imported modules to re-export. */
  exports?: readonly (Token | ModuleRef)[];
}

export interface AviModule extends ModuleDefinition {
  readonly name: string;
  readonly prefix: string;
  readonly imports: readonly AviModule[];
  readonly providers: readonly Provider[];
  readonly controllers: readonly ControllerDefinition[];
  readonly exports: readonly (Token | AviModule)[];
}

const modules = new WeakSet<AviModule>();
let anonymous = 0;

export function defineModule(options: ModuleOptions = {}): AviModule {
  const prefix = options.prefix ?? '/';
  if (!prefix.startsWith('/')) throw new TypeError(`Prefix must start with "/": ${prefix}`);
  const name = options.name ?? `AnonymousModule${String(++anonymous)}`;

  const imports = (options.imports ?? []).map((ref, i) => {
    const module = toModule(ref);
    if (!module) {
      throw new TypeError(
        `${name}.imports[${String(i)}] is not a module: use defineModule or @Module${(ref as unknown) === undefined ? ' (is there a circular import?)' : ''}`,
      );
    }
    return module;
  });

  const module: AviModule = Object.freeze({
    name,
    prefix,
    imports: Object.freeze(imports),
    providers: Object.freeze((options.providers ?? []).map(withScope)),
    controllers: Object.freeze(
      (options.controllers ?? []).map((c) =>
        typeof c === 'function' ? controllerFromClass(c) : c,
      ),
    ),
    exports: Object.freeze(
      (options.exports ?? []).map((entry) =>
        typeof entry === 'function' ? (moduleClasses.get(entry) ?? entry) : entry,
      ),
    ),
  });
  modules.add(module);
  return module;
}

export function isModule(value: unknown): value is AviModule {
  return typeof value === 'object' && value !== null && modules.has(value as AviModule);
}

/** Resolves a module or `@Module` class. `undefined` if it is neither. */
export function toModule(ref: unknown): AviModule | undefined {
  if (isModule(ref)) return ref;
  return typeof ref === 'function' ? moduleClasses.get(ref as Class) : undefined;
}

// `@Injectable({ scope })` sets the scope of a class listed by itself.
function withScope(provider: Provider): Provider {
  if (typeof provider !== 'function') return provider;
  const scope = injectableScopes.get(provider);
  return scope ? { provide: provider, useClass: provider, scope } : provider;
}
