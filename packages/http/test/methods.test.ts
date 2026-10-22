import { describe, expect, expectTypeOf, it } from 'vitest';
import { HTTP_METHODS, type HttpMethod } from '../src/index.js';

describe('HTTP_METHODS', () => {
  it('lists each supported method once, in upper case', () => {
    expect(new Set(HTTP_METHODS).size).toBe(HTTP_METHODS.length);
    for (const method of HTTP_METHODS) expect(method).toBe(method.toUpperCase());
  });

  it('derives the HttpMethod union', () => {
    expectTypeOf<HttpMethod>().toEqualTypeOf<
      'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'
    >();
  });
});
