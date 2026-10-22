import { describe, expectTypeOf, it } from 'vitest';
import type { Class, InjectionToken, ResolveTokens, Token, TokenType } from '../src/index.js';

class Db {
  query() {
    return [];
  }
}

class Repo {
  constructor(readonly db: Db) {}
}

abstract class Logger {
  abstract log(message: string): void;
}

interface Config {
  port: number;
}

declare const ConfigToken: InjectionToken<Config>;

describe('Token', () => {
  it('accepts classes with constructor parameters', () => {
    expectTypeOf<typeof Repo>().toExtend<Class<Repo>>();
    expectTypeOf<typeof Repo>().toExtend<Token<Repo>>();
  });

  it('accepts abstract classes', () => {
    expectTypeOf<typeof Logger>().toExtend<Token<Logger>>();
  });

  it('accepts typed tokens', () => {
    expectTypeOf(ConfigToken).toExtend<Token<Config>>();
  });

  it('rejects plain strings', () => {
    expectTypeOf<'Config'>().not.toExtend<Token>();
  });
});

describe('TokenType', () => {
  it('unwraps classes and typed tokens', () => {
    expectTypeOf<TokenType<typeof Db>>().toEqualTypeOf<Db>();
    expectTypeOf<TokenType<typeof ConfigToken>>().toEqualTypeOf<Config>();
  });
});

describe('ResolveTokens', () => {
  it('maps an inject tuple in order', () => {
    expectTypeOf<ResolveTokens<[typeof Db, typeof ConfigToken, typeof Logger]>>().toEqualTypeOf<
      [Db, Config, Logger]
    >();
  });

  it('infers dependencies from a const inject list', () => {
    function withDeps<const K extends readonly Token[]>(
      inject: K,
      use: (...deps: ResolveTokens<K>) => void,
    ) {
      return { inject, use };
    }

    withDeps([Db, ConfigToken], (db, config) => {
      expectTypeOf(db).toEqualTypeOf<Db>();
      expectTypeOf(config).toEqualTypeOf<Config>();
    });
  });
});
