import type { AddressInfo } from 'node:net';
import { describe, expectTypeOf, it } from 'vitest';
import { createAvi, defineController, type AviApp, type Context } from '../src/index.js';

describe('public API types', () => {
  it('types the handler context', () => {
    defineController({
      routes: [
        {
          method: 'GET',
          path: '/',
          handler: (ctx) => {
            expectTypeOf(ctx).toEqualTypeOf<Context>();
            expectTypeOf(ctx.query).toEqualTypeOf<URLSearchParams>();
            expectTypeOf(ctx.json()).toEqualTypeOf<Promise<unknown>>();
            return 'ok';
          },
        },
      ],
    });
  });

  it('only accepts known HTTP methods', () => {
    defineController({
      // @ts-expect-error not an HTTP method
      routes: [{ method: 'FETCH', path: '/', handler: () => 'x' }],
    });
  });

  it('chains register and resolves listen to an address', () => {
    const app = createAvi();
    expectTypeOf(app.register({ controllers: [] })).toEqualTypeOf<AviApp>();
    expectTypeOf(app.listen(0)).toEqualTypeOf<Promise<AddressInfo>>();
  });
});
