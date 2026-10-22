import { describe, expect, it } from 'vitest';
import { joinPath } from '../src/controller.js';
import { defineController } from '../src/index.js';

const ok = () => 'ok';

class Users {
  all() {
    return [];
  }
}

describe('defineController', () => {
  it('defaults the prefix to / and inject to nothing', () => {
    const controller = defineController({ routes: [] });
    expect(controller.prefix).toBe('/');
    expect(controller.inject).toEqual([]);
  });

  it('returns frozen, copied routes for a plain array', () => {
    const routes = [{ method: 'GET' as const, path: '/', handler: ok }];
    const controller = defineController({ prefix: '/a', routes });
    routes.push({ method: 'GET', path: '/b', handler: ok });

    const created = controller.createRoutes([]);
    expect(created).toHaveLength(1);
    expect(Object.isFrozen(controller)).toBe(true);
    expect(Object.isFrozen(created)).toBe(true);
  });

  it('passes resolved dependencies to a routes factory', () => {
    const users = new Users();
    const controller = defineController({
      inject: [Users],
      routes: (u) => [{ method: 'GET', path: '/', handler: () => u.all() }],
    });
    expect(controller.inject).toEqual([Users]);
    const [route] = controller.createRoutes([users]);
    expect(route?.handler(undefined as never)).toEqual([]);
  });

  it('rejects a routes factory with more parameters than inject', () => {
    expect(() =>
      defineController({
        routes: ((_u: Users) => []) as never,
      }),
    ).toThrow('routes takes 1 arguments but inject lists 0');
  });

  it('rejects a prefix without a leading slash', () => {
    expect(() => defineController({ prefix: 'users', routes: [] })).toThrow('must start with "/"');
  });

  it('rejects a relative route path', () => {
    expect(() =>
      defineController({ routes: [{ method: 'GET', path: 'users', handler: ok }] }),
    ).toThrow('must be empty or start with "/"');
  });

  it('checks routes returned by a factory', () => {
    const controller = defineController({
      inject: [Users],
      routes: () => [{ method: 'GET', path: 'bad', handler: ok }],
    });
    expect(() => controller.createRoutes([new Users()])).toThrow('must be empty or start with "/"');
  });
});

describe('joinPath', () => {
  it.each([
    ['/', '/', '/'],
    ['/', '', '/'],
    ['/', '/health', '/health'],
    ['/users', '/', '/users'],
    ['/users', '', '/users'],
    ['/users/', '/me', '/users/me'],
    ['/api/', '/v1//items/', '/api/v1/items'],
  ])('joins %s + %s as %s', (prefix, path, expected) => {
    expect(joinPath(prefix, path)).toBe(expected);
  });
});
