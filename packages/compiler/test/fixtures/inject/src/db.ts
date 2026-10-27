import { Injectable, createToken } from '@avijs/core';

// Like Prisma's client: a constructor and a type with one name.
export const Db = class {
  query() {
    return [];
  }
};
export type Db = InstanceType<typeof Db>;

export interface Mailer {
  send(to: string): void;
}
export const Mailer = createToken<Mailer>('Mailer');

// A schema named like its type is not a token.
export const User = { kind: 'schema' } as const;
export type User = { name: string };

export class UsersRepo {
  constructor(
    readonly db: Db,
    readonly mailer: Mailer,
  ) {}
}

@Injectable()
export class Profiles {
  constructor(readonly user: User) {}
}
