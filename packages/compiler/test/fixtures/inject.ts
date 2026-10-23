import { createToken, defineConfig, type StandardSchemaV1 } from '@avijs/core';

class Db {
  query() {
    return 1;
  }
}
class SpecialDb extends Db {}
interface Config {
  url: string;
}
const Config = createToken<Config>('Config');
const Port = createToken<number>('Port');

export class Good {
  static inject = [Db, Config] as const;
  constructor(
    readonly db: Db,
    readonly config: Config,
  ) {}
}

export class Subtype {
  static inject = [SpecialDb] as const;
  constructor(readonly db: Db) {}
}

export class Optional {
  static inject = [Db] as const;
  constructor(
    readonly db: Db,
    readonly config?: Config,
  ) {}
}

export class Swapped {
  static inject = [Config, Db] as const;
  constructor(
    readonly db: Db,
    readonly config: Config,
  ) {}
}

export class Short {
  static inject = [Db] as const;
  constructor(
    readonly db: Db,
    readonly config: Config,
  ) {}
}

export class WrongToken {
  static inject = [Port] as const;
  constructor(readonly name: string) {}
}

const list = () => [Db];
export class Dynamic {
  static inject = list();
  constructor(readonly db: Db) {}
}

export class NotDi {
  constructor(readonly anything: string) {}
}

// Generic constructors, like Prisma's PrismaClient: the token's instance type has type
// parameters, the constructor parameter uses the defaults.
interface Client<T = string> {
  value: T;
}
declare const Client: new <T = string>() => Client<T>;
class Repo<T = number> {
  item?: T;
}

export class PrismaLike {
  static inject = [Client, Repo] as const;
  constructor(
    readonly client: Client,
    readonly repo: Repo,
  ) {}
}

export class GenericMismatch {
  static inject = [Client] as const;
  constructor(readonly db: Db) {}
}

// Config tokens are InjectionToken subtypes; they resolve to the schema's output.
const Settings = defineConfig({} as StandardSchemaV1<unknown, { port: number }>);

export class UsesSettings {
  static inject = [Settings] as const;
  constructor(readonly settings: { port: number }) {}
}

export class WrongSettings {
  static inject = [Settings] as const;
  constructor(readonly port: string) {}
}
