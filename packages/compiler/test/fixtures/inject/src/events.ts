import { Clock } from './clock.js';

// The project's own listen starts nothing: the class is still listed.
class Bus {
  listen(event: string): () => string {
    return () => event;
  }
}
export const off = new Bus().listen('tick');

export class Ticker {
  constructor(readonly clock: Clock) {}
}
