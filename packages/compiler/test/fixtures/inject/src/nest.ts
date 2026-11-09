import { Clock } from './clock.js';
import { workers } from './lib/index.js';

export const nest = workers.cluster(() => undefined);

export class Nest {
  constructor(readonly clock: Clock) {}
}
