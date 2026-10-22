import { describe, expect, it } from 'vitest';
import { Router, type Handler, type RouteDefinition, type RouteMatch } from '../src/index.js';

const h = (name: string): Handler => Object.assign(() => name, { label: name });

function router(...routes: [RouteDefinition['method'], string][]): Router {
  const r = new Router();
  r.add(routes.map(([method, path]) => ({ method, path, handler: h(`${method} ${path}`) })));
  return r;
}

/** `"GET /users/:id"`, the params, or the kind of miss. */
function resolve(r: Router, method: string, path: string) {
  const match: RouteMatch = r.find(method, path);
  if (match.kind !== 'found') return match;
  return {
    route: (match.handler as Handler & { label: string }).label,
    params: { ...match.params },
  };
}

describe('static routes', () => {
  const r = router(['GET', '/'], ['GET', '/users'], ['GET', '/users/me'], ['POST', '/users']);

  it('matches by method and path', () => {
    expect(resolve(r, 'GET', '/')).toEqual({ route: 'GET /', params: {} });
    expect(resolve(r, 'GET', '/users')).toEqual({ route: 'GET /users', params: {} });
    expect(resolve(r, 'POST', '/users')).toEqual({ route: 'POST /users', params: {} });
    expect(resolve(r, 'GET', '/users/me')).toEqual({ route: 'GET /users/me', params: {} });
  });

  it('ignores one trailing slash', () => {
    expect(resolve(r, 'GET', '/users/')).toMatchObject({ route: 'GET /users' });
    expect(resolve(r, 'GET', '/users/me/')).toMatchObject({ route: 'GET /users/me' });
  });

  it('does not collapse empty segments', () => {
    expect(resolve(r, 'GET', '//users')).toEqual({ kind: 'not-found' });
    expect(resolve(r, 'GET', '/users//me')).toEqual({ kind: 'not-found' });
    expect(resolve(r, 'GET', '/users//')).toEqual({ kind: 'not-found' });
  });

  it('is case-sensitive', () => {
    expect(resolve(r, 'GET', '/Users')).toEqual({ kind: 'not-found' });
  });

  it('treats a trailing slash in the route definition as absent', () => {
    expect(resolve(router(['GET', '/a/']), 'GET', '/a')).toMatchObject({ route: 'GET /a/' });
  });

  it('returns not-found for request targets that are not paths', () => {
    expect(resolve(r, 'OPTIONS', '*')).toEqual({ kind: 'not-found' });
    expect(resolve(r, 'GET', 'http://example.com/users')).toEqual({ kind: 'not-found' });
  });
});

describe('parameters', () => {
  it('captures named segments', () => {
    const r = router(['GET', '/users/:id'], ['GET', '/users/:id/posts/:postId']);
    expect(resolve(r, 'GET', '/users/42')).toEqual({
      route: 'GET /users/:id',
      params: { id: '42' },
    });
    expect(resolve(r, 'GET', '/users/42/posts/7')).toEqual({
      route: 'GET /users/:id/posts/:postId',
      params: { id: '42', postId: '7' },
    });
  });

  it('never matches an empty segment', () => {
    const r = router(['GET', '/users/:id/posts']);
    expect(resolve(r, 'GET', '/users//posts')).toEqual({ kind: 'not-found' });
  });

  it('decodes values once, after splitting', () => {
    const r = router(['GET', '/files/:name']);
    expect(resolve(r, 'GET', '/files/a%2Fb')).toMatchObject({ params: { name: 'a/b' } });
    expect(resolve(r, 'GET', '/files/caf%C3%A9')).toMatchObject({ params: { name: 'café' } });
    expect(resolve(r, 'GET', '/files/%2525')).toMatchObject({ params: { name: '%25' } });
  });

  it('keeps dot segments literal', () => {
    const r = router(['GET', '/files/:name']);
    expect(resolve(r, 'GET', '/files/..')).toMatchObject({ params: { name: '..' } });
  });

  it('builds params without a prototype', () => {
    const r = router(['GET', '/:__proto__']);
    const match = r.find('GET', '/polluted');
    expect(match.kind === 'found' && Object.getPrototypeOf(match.params)).toBeNull();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('catch-all', () => {
  const r = router(['GET', '/files/*'], ['GET', '/files/readme']);

  it('captures the rest of the path, decoded', () => {
    expect(resolve(r, 'GET', '/files/a/b%20c.txt')).toEqual({
      route: 'GET /files/*',
      params: { '*': 'a/b c.txt' },
    });
  });

  it('matches zero segments', () => {
    expect(resolve(r, 'GET', '/files')).toMatchObject({ params: { '*': '' } });
    expect(resolve(r, 'GET', '/files/')).toMatchObject({ params: { '*': '' } });
  });

  it('loses to a static route', () => {
    expect(resolve(r, 'GET', '/files/readme')).toMatchObject({ route: 'GET /files/readme' });
  });

  it('refuses remainders with empty segments', () => {
    expect(resolve(r, 'GET', '/files//etc/passwd')).toEqual({ kind: 'not-found' });
    expect(resolve(r, 'GET', '/files/a//b')).toEqual({ kind: 'not-found' });
  });
});

describe('precedence', () => {
  it('prefers static, then parameter, then catch-all, in any registration order', () => {
    const routes: [RouteDefinition['method'], string][] = [
      ['GET', '/users/*'],
      ['GET', '/users/:id'],
      ['GET', '/users/me'],
    ];
    for (const order of [routes, [...routes].reverse()]) {
      const r = router(...order);
      expect(resolve(r, 'GET', '/users/me')).toMatchObject({ route: 'GET /users/me' });
      expect(resolve(r, 'GET', '/users/42')).toMatchObject({ route: 'GET /users/:id' });
      expect(resolve(r, 'GET', '/users/42/x')).toMatchObject({ route: 'GET /users/*' });
    }
  });

  it('backtracks when the static branch has no matching route', () => {
    const r = router(['GET', '/users/me/posts'], ['GET', '/users/:id/settings']);
    expect(resolve(r, 'GET', '/users/me/settings')).toEqual({
      route: 'GET /users/:id/settings',
      params: { id: 'me' },
    });
  });

  it('backtracks per method', () => {
    const r = router(['GET', '/users/me'], ['DELETE', '/users/:id']);
    expect(resolve(r, 'DELETE', '/users/me')).toEqual({
      route: 'DELETE /users/:id',
      params: { id: 'me' },
    });
  });

  it('drops parameters captured on an abandoned branch', () => {
    const r = router(['GET', '/:a/x'], ['GET', '/*']);
    expect(resolve(r, 'GET', '/one/y')).toEqual({ route: 'GET /*', params: { '*': 'one/y' } });
  });
});

describe('methods', () => {
  const r = router(['GET', '/items'], ['POST', '/items'], ['DELETE', '/items/:id']);

  it('answers 405 with the allowed methods when only the method is wrong', () => {
    expect(resolve(r, 'PUT', '/items')).toEqual({
      kind: 'method-not-allowed',
      allow: 'GET, HEAD, POST, OPTIONS',
    });
    expect(resolve(r, 'PROPFIND', '/items')).toMatchObject({ kind: 'method-not-allowed' });
    expect(resolve(r, 'PUT', '/missing')).toEqual({ kind: 'not-found' });
  });

  it('lists methods from every route that matches the path', () => {
    const multi = router(['GET', '/users/me'], ['DELETE', '/users/:id'], ['PATCH', '/users/*']);
    expect(resolve(multi, 'PUT', '/users/me')).toEqual({
      kind: 'method-not-allowed',
      allow: 'GET, HEAD, PATCH, DELETE, OPTIONS',
    });
  });

  it('serves HEAD from GET unless HEAD has its own route', () => {
    expect(resolve(r, 'HEAD', '/items')).toMatchObject({ route: 'GET /items' });
    const own = router(['GET', '/a'], ['HEAD', '/a']);
    expect(resolve(own, 'HEAD', '/a')).toMatchObject({ route: 'HEAD /a' });
  });

  it('prefers an explicit HEAD route, even a parameter one, over a static GET', () => {
    const r2 = router(['GET', '/a'], ['HEAD', '/:x']);
    expect(resolve(r2, 'HEAD', '/a')).toEqual({ route: 'HEAD /:x', params: { x: 'a' } });
    expect(resolve(r2, 'GET', '/a')).toMatchObject({ route: 'GET /a' });
  });

  it('matches static routes with or without one trailing slash', () => {
    const r2 = router(['GET', '/'], ['GET', '/a/b']);
    expect(resolve(r2, 'GET', '/a/b/')).toMatchObject({ route: 'GET /a/b' });
    expect(resolve(r2, 'GET', '//')).toEqual({ kind: 'not-found' });
    expect(resolve(r2, 'GET', '/a//b')).toEqual({ kind: 'not-found' });
  });

  it('answers OPTIONS automatically unless OPTIONS has its own route', () => {
    expect(resolve(r, 'OPTIONS', '/items/7')).toEqual({
      kind: 'options',
      allow: 'DELETE, OPTIONS',
    });
    expect(resolve(r, 'OPTIONS', '/nope')).toEqual({ kind: 'not-found' });
    const own = router(['OPTIONS', '/a']);
    expect(resolve(own, 'OPTIONS', '/a')).toMatchObject({ route: 'OPTIONS /a' });
  });
});

describe('malformed input', () => {
  it.each(['/%', '/%E0%A4', '/users/%ZZ', '/a/%C3'])('reports %s as malformed', (path) => {
    expect(resolve(router(['GET', '/*']), 'GET', path)).toEqual({ kind: 'malformed' });
  });
});

describe('registration', () => {
  const add =
    (...paths: string[]) =>
    () =>
      router(...paths.map((path): [RouteDefinition['method'], string] => ['GET', path]));

  it.each<[string, string[], string]>([
    ['a duplicate route', ['/a', '/a'], 'Duplicate route: GET /a'],
    ['a duplicate after normalizing', ['/a', '/a/'], 'Duplicate route'],
    ['renamed parameters', ['/users/:id', '/users/:userId'], 'Conflicting parameter names'],
    [
      'renamed parameters in other routes',
      ['/u/:id/a', '/u/:uid/b'],
      'Conflicting parameter names',
    ],
    ['a repeated parameter', ['/:id/:id'], 'Duplicate parameter "id"'],
    ['an invalid parameter name', ['/:1x'], 'Invalid parameter name'],
    ['an empty parameter name', ['/users/:'], 'Invalid parameter name'],
    ['a catch-all before the end', ['/*/x'], 'must be the last segment'],
    ['a partial catch-all', ['/files*'], 'must be a whole segment'],
    ['an empty segment', ['/a//b'], 'empty segment'],
    ['bad encoding', ['/a%E0'], 'Malformed percent-encoding'],
    ['a relative path', ['users'], 'must start with "/"'],
  ])('rejects %s', (_, paths, message) => {
    expect(add(...paths)).toThrow(message);
  });

  it('allows the same parameter name under different parents', () => {
    expect(add('/users/:id', '/posts/:id')).not.toThrow();
  });

  it('matches percent-encoded static segments by their decoded text', () => {
    const r = router(['GET', '/caf%C3%A9'], ['GET', '/a b']);
    expect(resolve(r, 'GET', '/caf%C3%A9')).toMatchObject({ route: 'GET /caf%C3%A9' });
    expect(resolve(r, 'GET', '/a%20b')).toMatchObject({ route: 'GET /a b' });
  });

  it('rejects unknown methods and missing handlers', () => {
    const r = new Router();
    expect(() => {
      r.add([{ method: 'FETCH' as 'GET', path: '/', handler: h('x') }]);
    }).toThrow('Unsupported HTTP method: FETCH');
    expect(() => {
      r.add([{ method: 'GET', path: '/', handler: undefined as unknown as Handler }]);
    }).toThrow('must be a function');
  });

  it('adds nothing when any route in a batch is invalid', () => {
    const r = router(['GET', '/kept']);
    expect(() => {
      r.add([
        { method: 'GET', path: '/new', handler: h('new') },
        { method: 'GET', path: '/kept', handler: h('dup') },
      ]);
    }).toThrow('Duplicate route');
    expect(resolve(r, 'GET', '/new')).toEqual({ kind: 'not-found' });
    expect(resolve(r, 'GET', '/kept')).toMatchObject({ route: 'GET /kept' });
  });
});
