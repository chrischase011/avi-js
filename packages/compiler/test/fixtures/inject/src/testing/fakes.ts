import { createTestClient } from '@avijs/testing';
import { Clock } from '../clock.js';

// Imports a devDependency: a production install would not have it.
export class FakeMailer {
  constructor(readonly clock: Clock) {}
}
export const client = createTestClient;
