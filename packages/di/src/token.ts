export type Class<T = unknown> = abstract new (...args: never[]) => T;

declare const tokenType: unique symbol;

/** A typed, non-class token. Created with `createToken<T>()` (Phase 3). */
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
