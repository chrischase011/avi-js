import * as workers from '@avijs/workers';
import { Clock } from './clock.js';

export const handle = workers.cluster(() => undefined);

export class Spawner {
  constructor(readonly clock: Clock) {}
}
