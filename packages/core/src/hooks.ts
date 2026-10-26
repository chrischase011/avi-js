import type { ResolveTokens, Token } from '@avijs/di';
import type { RequestHook } from '@avijs/http';

const HOOK = Symbol('avi.hook');

/** An `onRequest` hook built from injected values when the app starts. See `defineHook`. */
export interface HookDefinition {
  readonly [HOOK]: true;
  readonly inject: readonly Token[];
  readonly create: (...deps: never[]) => RequestHook;
}

/**
 * An `onRequest` hook that needs providers, such as CORS settings from the config. `create` runs
 * once at startup with `inject` resolved from the root modules, typed in order.
 */
export function defineHook<const K extends readonly Token[] = []>(definition: {
  inject?: K;
  create: (...deps: ResolveTokens<K>) => RequestHook;
}): HookDefinition {
  if (typeof definition.create !== 'function') {
    throw new TypeError('defineHook needs a create function');
  }
  return Object.freeze({
    [HOOK]: true as const,
    inject: Object.freeze([...(definition.inject ?? [])]),
    create: definition.create as unknown as HookDefinition['create'],
  });
}

export function isHookDefinition(value: unknown): value is HookDefinition {
  return typeof value === 'object' && value !== null && HOOK in value;
}
