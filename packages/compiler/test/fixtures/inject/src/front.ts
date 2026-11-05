import { Clock } from './clock.js';

// `listen` is only a signature here: the server comes from elsewhere.
interface Listener {
  listen(port: number): unknown;
}
declare function createServer(): Listener;
export const front = createServer().listen(3000);

export class Front {
  constructor(readonly clock: Clock) {}
}
