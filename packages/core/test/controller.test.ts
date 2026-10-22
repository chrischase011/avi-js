import { describe, expect, it } from 'vitest';
import { joinPath } from '../src/controller.js';
import { defineController } from '../src/index.js';

const ok = () => 'ok';

describe('defineController', () => {
  it('defaults the prefix to /', () => {
    expect(defineController({ routes: [] }).prefix).toBe('/');
  });

  it('returns a frozen copy of the routes', () => {
    const routes = [{ method: 'GET' as const, path: '/', handler: ok }];
    const controller = defineController({ prefix: '/a', routes });
    routes.push({ method: 'GET', path: '/b', handler: ok });

    expect(controller.routes).toHaveLength(1);
    expect(Object.isFrozen(controller)).toBe(true);
    expect(Object.isFrozen(controller.routes)).toBe(true);
  });

  it('rejects a prefix without a leading slash', () => {
    expect(() => defineController({ prefix: 'users', routes: [] })).toThrow('must start with "/"');
  });

  it('rejects a relative route path', () => {
    expect(() =>
      defineController({ routes: [{ method: 'GET', path: 'users', handler: ok }] }),
    ).toThrow('must be empty or start with "/"');
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
