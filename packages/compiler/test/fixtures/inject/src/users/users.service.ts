import { EventEmitter } from 'node:events';
import type { Clock } from '../clock.js';
import type { Config } from '../config.js';

export class UsersService {
  constructor(
    private readonly config: Config,
    private readonly clock: Clock,
    readonly events: EventEmitter,
  ) {}

  name() {
    return `${this.config.NAME} ${String(this.clock.now())}`;
  }
}
