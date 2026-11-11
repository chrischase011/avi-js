import { Injectable } from '@avijs/core';
import type { CreateUser } from './users.schemas.js';

export interface User {
  id: number;
  name: string;
}

@Injectable()
export class UsersService {
  readonly #users: User[] = [{ id: 1, name: 'Shiela' }];

  findAll(): User[] {
    return this.#users;
  }

  findOne(id: number): User | undefined {
    return this.#users.find((user) => user.id === id);
  }

  create(input: CreateUser): User {
    const user = { id: this.#users.length + 1, name: input.name };
    this.#users.push(user);
    return user;
  }
}
