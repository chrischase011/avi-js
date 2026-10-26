// The background worker: sends queued emails until stopped. ONCE=1 empties the outbox and exits.
import { setTimeout as sleep } from 'node:timers/promises';
import { runWorker } from '@avijs/workers';
import { OUTBOX, OutboxModule } from './outbox.js';

await runWorker(OutboxModule, async (app, signal) => {
  const outbox = app.get(OUTBOX);
  while (!signal.aborted) {
    const files = await outbox.pending();
    for (const file of files) {
      const email = await outbox.read(file);
      // A real worker calls an email provider here, passing `signal` along.
      console.log(`sent "${email.subject}" to ${email.to}`);
      await outbox.remove(file);
    }
    if (process.env['ONCE']) return;
    if (files.length === 0) await sleep(500, undefined, { signal }).catch(() => undefined);
  }
});
