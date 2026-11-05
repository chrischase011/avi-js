import { Clock } from '../clock.js';
import './b.js';

// Reaches a devDependency through b.ts, which imports this file back.
export class LoopA {
  constructor(readonly clock: Clock) {}
}
