import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type Role = 'superadmin' | 'admin' | 'member';

export interface User {
  id: number;
  username: string;
  role: Role;
}

declare module '@avijs/core' {
  interface AviState {
    /** Set by AuthGuard. */
    user?: User;
  }
}

interface StoredUser extends User {
  salt: Buffer;
  hash: Buffer;
}

function hash(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}

function stored(id: number, username: string, role: Role, password: string): StoredUser {
  const salt = randomBytes(16);
  return { id, username, role, salt, hash: hash(password, salt) };
}

/** Demo users with hashed passwords. A real app reads them from a database. */
export class UsersService {
  readonly #users = [
    stored(1, 'shiela', 'superadmin', 'my-love-forever'),
    stored(2, 'ada', 'admin', 'analytical-engine'),
    stored(3, 'grace', 'member', 'cobol-forever'),
  ];

  verify(username: string, password: string): User | undefined {
    const user = this.#users.find((candidate) => candidate.username === username);
    // Hash even for unknown users, so response time doesn't reveal which usernames exist.
    const actual = hash(password, user?.salt ?? randomBytes(16));
    if (!user || !timingSafeEqual(actual, user.hash)) return undefined;
    return { id: user.id, username: user.username, role: user.role };
  }

  count(): number {
    return this.#users.length;
  }
}
