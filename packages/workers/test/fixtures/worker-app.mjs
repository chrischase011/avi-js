// A background worker for the tests. MODE picks what the work does; stdin 'signal' simulates
// SIGTERM the same way on every platform.
import { createToken, defineModule } from '@avijs/core';
import { runWorker } from '@avijs/workers';
import { createInterface } from 'node:readline';

const Db = createToken('Db');
const Jobs = createToken('Jobs');

const AppModule = defineModule({
  name: 'AppModule',
  providers: [
    {
      provide: Db,
      useFactory: () => {
        if (process.env.MODE === 'startfail') {
          throw new Error('cannot connect', { cause: new Error('ECONNREFUSED') });
        }
        return { [Symbol.asyncDispose]: async () => console.log('closed Db') };
      },
    },
    {
      provide: Jobs,
      inject: [Db],
      useFactory: () => ({
        next: () => new Promise((resolve) => setTimeout(() => resolve('job'), 20)),
        [Symbol.asyncDispose]: async () => console.log('closed Jobs'),
      }),
    },
  ],
});

const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (line === 'signal') process.emit('SIGTERM');
});

await runWorker(AppModule, async (app, signal) => {
  const jobs = app.get(Jobs);
  console.log('working');
  if (process.env.MODE === 'throw') throw new Error('job failed');
  if (process.env.MODE === 'once') return;
  let done = 0;
  while (!signal.aborted) {
    await jobs.next();
    done++;
  }
  console.log(`stopped after ${done > 0 ? 'some' : 'no'} jobs`);
});
console.log(`exit code ${String(process.exitCode ?? 0)}`);
input.close();
