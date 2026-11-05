import { Clock } from './clock.js';
import '#lib/dev.js';

// Reaches a devDependency through an `imports` entry with only an "import" condition.
export class Hashed {
  constructor(readonly clock: Clock) {}
}
