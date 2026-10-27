import { Clock } from './clock.js';

export abstract class Repo {
  constructor(protected readonly clock: Clock) {}
}

// No constructor: it inherits Repo's list.
export class UsersRepoBase extends Repo {}

export class WithOptional {
  constructor(
    readonly clock: Clock,
    readonly extra?: Clock,
  ) {}
}
