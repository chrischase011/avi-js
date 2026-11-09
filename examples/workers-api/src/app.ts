import { HttpError, defineController, defineModule, reply, sse } from '@avijs/core';
import { OUTBOX, OutboxModule, type Email } from './outbox.js';
import { EmailEvents, PubSub } from './pubsub.js';

const emails = defineController({
  prefix: '/emails',
  inject: [OUTBOX, PubSub],
  routes: (outbox, pubsub) => [
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
        await pubsub.publish(EmailEvents, { id, to: body.to });
        return reply({ id, queued: true }, { status: 202 });
      },
    },
    {
      method: 'GET',
      path: '/pending',
      handler: async () => ({ count: (await outbox.pending()).length }),
    },
    {
      // Every queued email, whichever worker queued it.
      method: 'GET',
      path: '/events',
      handler: (ctx) => sse(ctx, (signal) => pubsub.events(EmailEvents, signal)),
    },
  ],
});

// Which process answered, to see the cluster at work.
const info = defineController({
  routes: [{ method: 'GET', path: '/pid', handler: () => ({ pid: process.pid }) }],
});

export const AppModule = defineModule({
  name: 'AppModule',
  imports: [OutboxModule, PubSub.module],
  controllers: [emails, info],
});
