import { isToken, type Class, type Token } from './token.js';

/**
 * Gives classes the `static inject` lists that `avi dev` and `avi build` infer from constructor
 * types and write to `inject.gen.ts`. A class that declares its own `static inject` keeps it.
 */
export function registerInjects(entries: readonly (readonly [Class, readonly Token[]])[]): void {
  for (const [cls, tokens] of entries) {
    if (typeof cls !== 'function') {
      throw new TypeError('registerInjects: expected a class (is there a circular import?)');
    }
    tokens.forEach((token, i) => {
      if (!isToken(token)) {
        throw new TypeError(
          `registerInjects: dependency ${String(i)} of ${cls.name} is not a token (is there a circular import?)`,
        );
      }
    });
    if (Object.hasOwn(cls, 'inject')) continue;
    Object.defineProperty(cls, 'inject', { value: Object.freeze([...tokens]), configurable: true });
  }
}
