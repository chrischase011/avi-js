export type Class<T = unknown> = abstract new (...args: never[]) => T;

/** A class Avi can construct. Dependencies are listed in `static inject`. */
export type Constructor<T = unknown> = (new (...args: never[]) => T) & {
  readonly inject?: readonly Token[];
};

declare const tokenType: unique symbol;

/** A typed, non-class token. Created with `createToken<T>()`. */
export interface InjectionToken<T> {
  readonly description: string;
  readonly [tokenType]?: T;
}

export type Token<T = unknown> = Class<T> | InjectionToken<T>;

export type TokenType<K> =
  K extends Class<infer T> ? T : K extends InjectionToken<infer T> ? T : never;

/** Maps an `inject` tuple to the tuple of values it resolves to. */
export type ResolveTokens<K extends readonly Token[]> = {
  -readonly [I in keyof K]: TokenType<K[I]>;
};

export function createToken<T>(description: string): InjectionToken<T> {
  if (typeof description !== 'string' || description === '') {
    throw new TypeError('createToken needs a non-empty description');
  }
  return Object.freeze({ description });
}

export function isToken(value: unknown): value is Token {
  return (
    typeof value === 'function' ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { description?: unknown }).description === 'string')
  );
}

export function tokenName(token: Token): string {
  return typeof token === 'function' ? token.name || '(anonymous class)' : token.description;
}
