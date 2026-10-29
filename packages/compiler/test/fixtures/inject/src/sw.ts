import { Clock } from './clock.js';

declare const navigator: { serviceWorker: { register(url: string): void } };

export class Cache {
  constructor(readonly clock: Clock) {}
}

navigator.serviceWorker.register('/sw.js');
