import { describe, expectTypeOf, it } from 'vitest';
import { createToken, defineFactory, type FactoryProvider, type Provider } from '../src/index.js';

class Db {
  query() {
    return [];
  }
}
interface Config {
  url: string;
}
const ConfigToken = createToken<Config>('Config');
const DbToken = createToken<Db>('Db');

describe('defineFactory', () => {
  it('types the factory from inject, in order', () => {
    const provider = defineFactory({
      provide: DbToken,
      inject: [ConfigToken, Db],
      useFactory: (config, db) => {
        expectTypeOf(config).toEqualTypeOf<Config>();
        expectTypeOf(db).toEqualTypeOf<Db>();
        return db;
      },
    });
    expectTypeOf(provider).toEqualTypeOf<FactoryProvider<Db>>();
    expectTypeOf(provider).toExtend<Provider>();
  });

  it('allows async singletons and a typed dispose', () => {
    defineFactory({
      provide: DbToken,
      useFactory: () => Promise.resolve(new Db()),
      dispose: (db) => {
        expectTypeOf(db).toEqualTypeOf<Db>();
      },
    });
  });

  it('rejects parameters that do not match inject', () => {
    defineFactory({
      provide: DbToken,
      inject: [ConfigToken],
      // @ts-expect-error the first dependency is a Config, not a Db
      useFactory: (db: Db) => db,
    });
    defineFactory({
      provide: DbToken,
      inject: [ConfigToken],
      // @ts-expect-error the factory must return what provide promises
      useFactory: (config) => config.url,
    });
  });
});
