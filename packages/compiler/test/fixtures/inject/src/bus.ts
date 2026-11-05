import { Clock } from './clock.js';

// An event bus typed by its interface: its `listen` starts nothing, so Audit is still listed.
export interface Bus {
  listen(event: string): () => void;
}
export class BusImpl implements Bus {
  listen(): () => void {
    return () => undefined;
  }
}
const bus: Bus = new BusImpl();
export const off = bus.listen('user.created');

export class Audit {
  constructor(readonly clock: Clock) {}
}
