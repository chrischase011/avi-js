import { Clock } from '../clock.js';

// Loads a devDependency through a local import.
export { FakeMailer } from './fakes.js';

export class FakeClock {
  constructor(readonly clock: Clock) {}
}
