import { Clock } from './clock.js';
import { cluster } from './lib/index.js';

export const swarm = cluster(() => undefined);

export class Swarm {
  constructor(readonly clock: Clock) {}
}
