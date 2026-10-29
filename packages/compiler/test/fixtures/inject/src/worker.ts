import { Clock } from './clock.js';

// An entry point: importing it would start the worker inside the web app.
export class EmailJob {
  constructor(readonly clock: Clock) {}
}

declare const runWorker: () => Promise<void>;
await runWorker();
