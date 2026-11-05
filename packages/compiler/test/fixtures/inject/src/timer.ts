import { Clock } from './clock.js';

export const tick = setInterval(() => undefined, 60_000);

export class Poller {
  constructor(readonly clock: Clock) {}
}
