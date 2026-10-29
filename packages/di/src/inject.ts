import { isToken, type Class, type Token } from './token.js';

type Entries = readonly (readonly [Class, readonly Token[]])[];

// Lists registered as a function, applied when Avi.js first reads a list: by then every module,
// including ones in an import cycle with inject.gen.ts, has finished loading.
const pending: (() => Entries)[] = [];

/**
 * Gives classes the `static inject` lists that `avi dev` and `avi build` infer from constructor
 * types and write to `inject.gen.ts`. A class that declares its own `static inject` keeps it.
 * Pass a function to defer reading the classes until the app starts.
 */
export function registerInjects(entries: Entries | (() => Entries)): void {
  if (typeof entries === 'function') pending.push(entries);
  else apply(entries);
}

/** Applies lists registered as functions. Avi.js calls it before it reads `static inject`. */
export function resolveInjects(): void {
  while (pending.length > 0) {
    const next = pending[0] as () => Entries;
    let entries: Entries;
    try {
      entries = next();
    } catch (error) {
      // It stays queued, so the next app that starts reports the same reason.
      if (!(error instanceof ReferenceError)) throw error;
      throw new TypeError(
        `inject.gen.ts lists a class that is not created yet (${error.message}): declare it before the app starts`,
        { cause: error },
      );
    }
    apply(entries);
    pending.shift();
  }
}

function apply(entries: Entries): void {
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

/** Why a class cannot be built: its constructor takes arguments and it has no dependency list. */
export function injectListError(name: string, needed: number, where?: string): TypeError {
  const args = `${String(needed)} constructor argument${needed === 1 ? '' : 's'}`;
  const at = where ? ` (at ${where})` : '';
  return new TypeError(
    `${name} has no dependency list for its ${args}${at}: add import './inject.gen.js' before the app starts, as app.module.ts does, or add static inject. avi dev reports AVI201 when it cannot infer a list`,
  );
}
