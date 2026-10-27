// Not imported by the app: the generated file must not import it either, or this would run.
import { Clock } from './clock.js';

export class Seeder {
  constructor(readonly clock: Clock) {}
}
console.log('seeding');
