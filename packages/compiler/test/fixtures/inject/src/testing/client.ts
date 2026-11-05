import { Clock } from '../clock.js';

// Re-exports a devDependency.
export { createTestClient } from '@avijs/testing';

export class TestApp {
  constructor(readonly clock: Clock) {}
}
