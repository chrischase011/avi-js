import { Clock } from './clock.js';

// No statement runs code, but the exported value starts a server.
export class Probe {
  constructor(readonly clock: Clock) {}
}

declare const createServer: () => { listen(port: number): unknown };
export const server = createServer().listen(3999);
