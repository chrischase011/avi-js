import { Clock } from './clock.js';
import { cluster as boot } from './lib/start.js';

export const fleet = boot(() => undefined);

export class Fleet {
  constructor(readonly clock: Clock) {}
}
