import type { AddressInfo } from 'node:net';
import { describe, expectTypeOf, it } from 'vitest';
import {
  createAvi,
  createToken,
  defineController,
  defineModule,
  type AviApp,
  type Context,
} from '../src/index.js';

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

describe('dependency injection types', () => {
  class Users {
    all() {
      return ['ada'];
    }
  }
  const Config = createToken<{ greeting: string }>('Config');

  it('infers routes factory parameters from inject', () => {
    defineController({
      inject: [Users, Config],
      routes: (users, config) => {
        expectTypeOf(users).toEqualTypeOf<Users>();
        expectTypeOf(config).toEqualTypeOf<{ greeting: string }>();
        return [];
      },
    });
  });

  it('rejects a routes factory that expects the wrong types', () => {
    defineController({
      inject: [Users],
      // @ts-expect-error the first dependency is Users, not a string
      routes: (name: string) => [{ method: 'GET', path: '/', handler: () => name }],
    });
  });

  it('types app.get by token', () => {
    const app = createAvi();
    expectTypeOf(app.get(Users)).toEqualTypeOf<Users>();
    expectTypeOf(app.get(Config)).toEqualTypeOf<{ greeting: string }>();
  });

  it('accepts typed factory and dispose callbacks in a providers list', () => {
    const Conn = createToken<{ close(): void }>('Conn');
    defineModule({
      providers: [
        Users,
        { provide: Config, useValue: { greeting: 'hi' } },
        {
          provide: Conn,
          useFactory: (config: { greeting: string }) => ({ close: () => config }),
          inject: [Config],
          dispose: (conn: { close(): void }) => {
            conn.close();
          },
        },
      ],
    });
  });

  it('rejects strings as tokens', () => {
    defineController({
      // @ts-expect-error strings are not tokens
      inject: ['Users'],
      routes: [],
    });
  });
});
