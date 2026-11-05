import { Clock } from './clock.js';
import '@/testing/fakes.js';

// Reaches a devDependency through a `paths` alias.
export class Aliased {
  constructor(readonly clock: Clock) {}
}
