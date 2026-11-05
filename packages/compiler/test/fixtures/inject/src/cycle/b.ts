import { Clock } from '../clock.js';
import './a.js';
import './c.js';

export class LoopB {
  constructor(readonly clock: Clock) {}
}
