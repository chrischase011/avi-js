import { injectListError } from './inject.js';
import { isToken, tokenName, type Constructor, type ResolveTokens, type Token } from './token.js';

/**
 * `singleton`: one instance per app. `transient`: a new one per injection. `request`: one per
 * request, created on first use and disposed after the handler.
 */
export type Scope = 'singleton' | 'transient' | 'request';

export interface ClassProvider<T = unknown> {
  provide: Token<T>;
  useClass: Constructor<T>;
  scope?: Scope;
}

export interface ValueProvider<T = unknown> {
  provide: Token<T>;
  useValue: T;
}

export interface FactoryProvider<T = unknown> {
  provide: Token<T>;
  /** Receives `inject` in order. Only singleton factories may return a promise. */
  useFactory: (...deps: never[]) => T | Promise<T>;
  inject?: readonly Token[];
  scope?: Scope;
  /**
   * Called with the created value on shutdown, or after the request for request scope. A method,
   * so typed callbacks fit `Provider[]`.
   */
  dispose?(value: T): unknown;
}

/** A factory provider whose parameters are typed from `inject`. */
export interface TypedFactoryProvider<T, K extends readonly Token[]> {
  provide: Token<T>;
  inject?: K;
  useFactory: (...deps: ResolveTokens<K>) => T | Promise<T>;
  scope?: Scope;
  dispose?(value: T): unknown;
}

/**
 * A factory provider checked against its `inject` list: parameters are inferred in order, and the
 * result must fit `provide`. Inside a plain `providers` array TypeScript cannot do this.
 */
export function defineFactory<T, const K extends readonly Token[] = []>(
  provider: TypedFactoryProvider<T, K>,
): FactoryProvider<T> {
  return provider as unknown as FactoryProvider<T>;
}

export type Provider<T = unknown> =
  Constructor<T> | ClassProvider<T> | ValueProvider<T> | FactoryProvider<T>;

export interface ProviderSpec {
  readonly token: Token;
  readonly kind: 'class' | 'value' | 'factory';
  readonly scope: Scope;
  readonly deps: readonly Token[];
  readonly create: (deps: unknown[]) => unknown;
  readonly dispose: ((value: unknown) => unknown) | undefined;
}

/** Validates a provider and converts it to one internal shape. `where` labels errors. */
export function normalizeProvider(provider: unknown, where: string): ProviderSpec {
  if (typeof provider === 'function') {
    return classSpec(provider as Constructor, provider as Constructor, 'singleton', where);
  }
  if (typeof provider !== 'object' || provider === null) {
    throw new TypeError(`Invalid provider at ${where}: ${String(provider)}${hint(provider)}`);
  }

  const p = provider as Record<string, unknown>;
  if (!isToken(p['provide'])) {
    throw new TypeError(
      `Invalid "provide" token at ${where}: ${String(p['provide'])}${hint(p['provide'])}`,
    );
  }
  const token = p['provide'];
  const label = `${where} (${tokenName(token)})`;
  const kinds = ['useClass', 'useValue', 'useFactory'].filter((key) => key in p);
  if (kinds.length !== 1) {
    throw new TypeError(
      `Provider at ${label} needs exactly one of useClass, useValue or useFactory`,
    );
  }

  if ('useValue' in p) {
    const value = p['useValue'];
    return {
      token,
      kind: 'value',
      scope: 'singleton',
      deps: [],
      create: () => value,
      dispose: undefined,
    };
  }

  const scope = p['scope'] ?? 'singleton';
  if (scope !== 'singleton' && scope !== 'transient' && scope !== 'request') {
    throw new TypeError(
      `Invalid scope ${typeof scope === 'string' ? `"${scope}"` : typeof scope} at ${label}`,
    );
  }

  if ('useClass' in p) {
    if (typeof p['useClass'] !== 'function') {
      throw new TypeError(`useClass at ${label} must be a class`);
    }
    return classSpec(token, p['useClass'] as Constructor, scope, label);
  }

  const factory = p['useFactory'];
  if (typeof factory !== 'function')
    throw new TypeError(`useFactory at ${label} must be a function`);
  const deps = checkInject(p['inject'], `${label} inject`);
  if (factory.length > deps.length) {
    throw new TypeError(
      `Factory at ${label} takes ${String(factory.length)} arguments but inject lists ${String(deps.length)}`,
    );
  }
  const dispose = p['dispose'];
  if (dispose !== undefined && typeof dispose !== 'function') {
    throw new TypeError(`dispose at ${label} must be a function`);
  }
  return {
    token,
    kind: 'factory',
    scope,
    deps,
    create: (values) => (factory as (...args: unknown[]) => unknown)(...values),
    dispose: dispose as ((value: unknown) => unknown) | undefined,
  };
}

function classSpec(token: Token, cls: Constructor, scope: Scope, where: string): ProviderSpec {
  const deps = checkInject(cls.inject, `${where} ${cls.name}.inject`);
  // A shorter list is fine: the parameters left out may be optional, which only types can tell.
  if (cls.inject === undefined && cls.length > 0) {
    throw injectListError(cls.name || 'Class', cls.length, where);
  }
  const Ctor = cls as unknown as new (...args: unknown[]) => unknown;
  return {
    token,
    kind: 'class',
    scope,
    deps,
    create: (values) => new Ctor(...values),
    dispose: undefined,
  };
}

function checkInject(inject: unknown, where: string): readonly Token[] {
  if (inject === undefined) return [];
  if (!Array.isArray(inject)) throw new TypeError(`${where} must be an array of tokens`);
  inject.forEach((token: unknown, i) => {
    if (!isToken(token)) {
      throw new TypeError(
        `Invalid token at ${where}[${String(i)}]: ${String(token)}${hint(token)}`,
      );
    }
  });
  return inject as readonly Token[];
}

function hint(value: unknown): string {
  return value === undefined ? ' (is there a circular import?)' : '';
}
