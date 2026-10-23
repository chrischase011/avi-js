import { Injectable } from '@avijs/core';
import type { CreateUserDto } from './dto/create-user.dto.js';

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

  create(dto: CreateUserDto): User {
    const user = { id: this.#users.length + 1, name: dto.name };
    this.#users.push(user);
    return user;
  }
}
