import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fillPath } from '../src/index.js';

const runs = { numRuns: Number(process.env['FUZZ_RUNS'] ?? 500) };

// Values a client might pass through from user input, dots and slashes included.
const value = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 20 }),
  fc.constantFrom('.', '..', '%2e%2e', '..%2f', '/', '//', 'a/../b', '?x=1', '#frag', '\\..'),
);

/** Values a URL cannot carry as one segment: they would change the route or the host. */
const refused = (v: string) => v === '' || v === '.' || v === '..';

/** The path a URL parser (and so fetch) actually requests, split into decoded segments. */
function requested(path: string): string[] {
  const { pathname } = new URL(`http://api.example${path}`);
  return pathname.slice(1).split('/').map(decodeURIComponent);
}

describe('fillPath (property)', () => {
  it('a value fills exactly its own segment, or is refused', () => {
    fc.assert(
      fc.property(value, value, (id, other) => {
        let path: string;
        try {
          path = fillPath('/teams/:team/users/:id', { team: other, id });
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
          expect([id, other].some(refused)).toBe(true);
          return;
        }
        expect(requested(path)).toEqual(['teams', other, 'users', id]);
      }),
      runs,
    );
  });

  it('a wildcard keeps its slashes but cannot climb out of its prefix', () => {
    fc.assert(
      fc.property(fc.array(value, { minLength: 1, maxLength: 4 }), (parts) => {
        const rest = parts.join('/');
        let path: string;
        try {
          path = fillPath('/files/*', { '*': rest });
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
          expect(rest !== '' && rest.split('/').some(refused)).toBe(true);
          return;
        }
        expect(requested(path)).toEqual(
          rest === '' ? ['files', ''] : ['files', ...rest.split('/')],
        );
      }),
      runs,
    );
  });
});
