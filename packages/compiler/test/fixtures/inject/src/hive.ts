import { Clock } from './clock.js';
import * as lib from './lib/all.js';

export const hive = lib.cluster(() => undefined);

export class Hive {
  constructor(readonly clock: Clock) {}
}
