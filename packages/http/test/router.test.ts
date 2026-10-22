import { describe, expect, it } from 'vitest';
import { Router, type RouteDefinition } from '../src/index.js';

const ok = () => 'ok';

describe('Router', () => {
  it('finds routes by exact method and path', () => {
    const router = new Router();
    const getUsers = () => [];
    const postUsers = () => ({});
    router.add([
      { method: 'GET', path: '/users', handler: getUsers },
      { method: 'POST', path: '/users', handler: postUsers },
    ]);

    expect(router.find('GET', '/users')).toBe(getUsers);
    expect(router.find('POST', '/users')).toBe(postUsers);
    expect(router.find('DELETE', '/users')).toBeUndefined();
    expect(router.find('GET', '/users/')).toBeUndefined();
    expect(router.find('GET', '/USERS')).toBeUndefined();
  });

  it('rejects a duplicate of an existing route', () => {
    const router = new Router();
    router.add([{ method: 'GET', path: '/a', handler: ok }]);
    expect(() => {
      router.add([{ method: 'GET', path: '/a', handler: ok }]);
    }).toThrow('Duplicate route: GET /a');
  });

  it('adds nothing when any route in a batch is invalid', () => {
    const router = new Router();
    expect(() => {
      router.add([
        { method: 'GET', path: '/a', handler: ok },
        { method: 'GET', path: '/a', handler: ok },
      ]);
    }).toThrow('Duplicate route');
    expect(router.find('GET', '/a')).toBeUndefined();
  });

  it.each<[string, Partial<RouteDefinition>, string]>([
    ['unknown method', { method: 'FETCH' as 'GET' }, 'Unsupported HTTP method: FETCH'],
    ['relative path', { path: 'users' }, 'must start with "/"'],
    ['parameter', { path: '/users/:id' }, 'not supported yet'],
    ['wildcard', { path: '/files/*' }, 'not supported yet'],
    ['missing handler', { handler: undefined }, 'must be a function'],
  ])('rejects %s', (_, override, message) => {
    const route: RouteDefinition = { method: 'GET', path: '/x', handler: ok, ...override };
    expect(() => {
      new Router().add([route]);
    }).toThrow(message);
  });
});
