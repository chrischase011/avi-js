import { describe, expectTypeOf, it } from 'vitest';
import { Controller, Get, Injectable, createToken, type Context } from '../src/index.js';

class Db {
  query() {
    return [];
  }
}
interface Config {
  url: string;
}
const Config = createToken<Config>('Config');

describe('static inject is checked against the constructor', () => {
  it('accepts a matching inject list', () => {
    @Injectable()
    class Repo {
      static inject = [Db, Config] as const;
      constructor(
        readonly db: Db,
        readonly config: Config,
      ) {}
    }
    expectTypeOf(Repo).not.toBeNever();
  });

  it('accepts classes without dependencies', () => {
    @Injectable()
    class Clock {
      now() {
        return 0;
      }
    }
    expectTypeOf(Clock).not.toBeNever();
  });

  it('rejects a swapped order', () => {
    // @ts-expect-error inject order does not match the constructor
    @Injectable()
    class Repo {
      static inject = [Config, Db] as const;
      constructor(
        readonly db: Db,
        readonly config: Config,
      ) {}
    }
    expectTypeOf(Repo).not.toBeNever();
  });

  it('rejects a missing inject list', () => {
    // @ts-expect-error constructor needs Db but inject is missing
    @Controller()
    class Users {
      constructor(readonly db: Db) {}
    }
    expectTypeOf(Users).not.toBeNever();
  });

  it('rejects an inject list without as const', () => {
    // @ts-expect-error a mutable array cannot be checked against the parameters
    @Injectable()
    class Repo {
      static inject = [Db];
      constructor(readonly db: Db) {}
    }
    expectTypeOf(Repo).not.toBeNever();
  });
});

describe('route decorators', () => {
  it('accept methods taking ctx or nothing', () => {
    @Controller()
    class Ok {
      @Get()
      list() {
        return [];
      }

      @Get('/:id')
      one(ctx: Context) {
        return ctx.params['id'];
      }
    }
    expectTypeOf(Ok).not.toBeNever();
  });

  it('reject methods expecting other arguments', () => {
    @Controller()
    class Bad {
      // @ts-expect-error handlers receive ctx, not an id
      @Get('/:id')
      one(id: number) {
        return id;
      }
    }
    expectTypeOf(Bad).not.toBeNever();
  });
});
