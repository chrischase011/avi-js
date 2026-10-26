import { HttpError, defineController, defineModule, reply } from '@avijs/core';
import { OUTBOX, OutboxModule, type Email } from './outbox.js';

const emails = defineController({
  prefix: '/emails',
  inject: [OUTBOX],
  routes: (outbox) => [
    {
      method: 'POST',
      path: '/',
      handler: async (ctx) => {
        const body = (await ctx.json()) as Partial<Email>;
        if (typeof body.to !== 'string' || typeof body.subject !== 'string') {
          throw new HttpError(400, 'Send { to, subject }');
        }
        // Queued for the background worker; the request does not wait for the send.
        const id = await outbox.add({ to: body.to, subject: body.subject });
        return reply({ id, queued: true }, { status: 202 });
      },
    },
    {
      method: 'GET',
      path: '/pending',
      handler: async () => ({ count: (await outbox.pending()).length }),
    },
  ],
});

// Which process answered, to see the cluster at work.
const info = defineController({
  routes: [{ method: 'GET', path: '/pid', handler: () => ({ pid: process.pid }) }],
});

export const AppModule = defineModule({
  name: 'AppModule',
  imports: [OutboxModule],
  controllers: [emails, info],
});
