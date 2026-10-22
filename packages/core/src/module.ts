import type { ModuleDefinition, Provider, Token } from '@avi/di';
import type { ControllerDefinition } from './controller.js';

export interface ModuleOptions {
  /** Used in error messages. */
  name?: string;
  /** Prepended to this module's own controllers, e.g. `/api/v1`. Not inherited by imports. */
  prefix?: string;
  imports?: readonly AviModule[];
  providers?: readonly Provider[];
  controllers?: readonly ControllerDefinition[];
  /** Own providers, re-exported tokens, or imported modules to re-export. */
  exports?: readonly (Token | AviModule)[];
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
  const imports = options.imports ?? [];
  imports.forEach((imported, i) => {
    if (!isModule(imported)) {
      throw new TypeError(
        `${name}.imports[${String(i)}] is not a module created with defineModule${(imported as unknown) === undefined ? ' (is there a circular import?)' : ''}`,
      );
    }
  });

  const module: AviModule = Object.freeze({
    name,
    prefix,
    imports: Object.freeze([...imports]),
    providers: Object.freeze([...(options.providers ?? [])]),
    controllers: Object.freeze([...(options.controllers ?? [])]),
    exports: Object.freeze([...(options.exports ?? [])]),
  });
  modules.add(module);
  return module;
}

export function isModule(value: unknown): value is AviModule {
  return typeof value === 'object' && value !== null && modules.has(value as AviModule);
}
