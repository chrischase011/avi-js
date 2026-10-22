import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Router, type RouteDefinition } from '../src/index.js';

const ok = () => 'ok';
const segment = fc.string({ minLength: 1, maxLength: 12, unit: 'grapheme' });
const literal = segment.filter((s) => !s.includes('/') && !s.startsWith(':') && !s.includes('*'));

describe('router properties', () => {
  it('never throws on arbitrary request paths', () => {
    const router = new Router();
    router.add([
      { method: 'GET', path: '/users/:id', handler: ok },
      { method: 'GET', path: '/files/*', handler: ok },
      { method: 'GET', path: '/a/b/c', handler: ok },
    ]);
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 200 }),
        fc.constantFrom('GET', 'PUT', 'HEAD', 'OPTIONS', 'X'),
        (path, method) => {
          router.find(method, path);
          router.find(method, `/${path}`);
        },
      ),
    );
  });

  it('round-trips any parameter value through percent-encoding', () => {
    const router = new Router();
    router.add([{ method: 'GET', path: '/items/:id/tags/:tag', handler: ok }]);
    fc.assert(
      fc.property(segment, segment, (id, tag) => {
        const match = router.find(
          'GET',
          `/items/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`,
        );
        expect(match.kind).toBe('found');
        if (match.kind === 'found') expect({ ...match.params }).toEqual({ id, tag });
      }),
    );
  });

  it('finds any static route by its encoded path', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.array(literal, { minLength: 1, maxLength: 4 }), {
          maxLength: 8,
          selector: (s) => s.join('/'),
        }),
        (paths) => {
          const router = new Router();
          router.add(
            paths.map((segments) => ({
              method: 'GET',
              path: `/${segments.map(encodeURIComponent).join('/')}`,
              handler: ok,
            })),
          );
          for (const segments of paths) {
            const match = router.find('GET', `/${segments.map(encodeURIComponent).join('/')}`);
            expect(match.kind).toBe('found');
          }
        },
      ),
    );
  });

  it('gives the same answers for any registration order', () => {
    const routes: RouteDefinition[] = [
      { method: 'GET', path: '/users/me', handler: () => 'me' },
      { method: 'GET', path: '/users/:id', handler: () => 'id' },
      { method: 'GET', path: '/users/:id/posts', handler: () => 'posts' },
      { method: 'GET', path: '/users/*', handler: () => 'rest' },
      { method: 'POST', path: '/users', handler: () => 'create' },
      { method: 'GET', path: '/*', handler: () => 'root' },
    ];
    const probes = ['/users/me', '/users/7', '/users/7/posts', '/users/7/x/y', '/users', '/x', '/'];
    const answer = (router: Router) =>
      probes.map((path) => {
        const match = router.find('GET', path);
        return match.kind === 'found'
          ? [match.handler(undefined as never), { ...match.params }]
          : match;
      });

    const reference = new Router();
    reference.add(routes);
    const expected = answer(reference);

    fc.assert(
      fc.property(fc.shuffledSubarray(routes, { minLength: routes.length }), (shuffled) => {
        const router = new Router();
        router.add(shuffled);
        expect(answer(router)).toEqual(expected);
      }),
    );
  });
});
