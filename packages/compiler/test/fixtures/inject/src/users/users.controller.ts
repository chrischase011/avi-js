import { Controller, Get, Injectable } from '@avijs/core';
import { Clock } from '../clock.js';
import { UsersService } from './users.service.js';

@Controller('/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('/')
  list() {
    return this.users.name();
  }
}

// Written by hand: kept as is.
export class Explicit {
  static inject = [Clock] as const;
  constructor(readonly clock: Clock) {}
}

// Not a DI class: nothing to infer, nothing to say.
export class Money {
  constructor(readonly amount: number) {}
}

@Injectable()
export class Partial {
  constructor(
    readonly users: UsersService,
    readonly label: string,
  ) {}
}

class Hidden {
  constructor(readonly clock: Clock) {}
}
export const hidden = Hidden;
