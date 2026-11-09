// Two workers. Each answers a "ping" with a "pong" carrying its pid; /live streams the pongs.
import { createAvi, defineController, sse } from '@avijs/core';
import { clusterAdapter, defineChannel, definePubSub } from '@avijs/pubsub';
import { cluster } from '@avijs/workers';

const PubSub = definePubSub({ adapter: clusterAdapter() });
const Ping = defineChannel('ping');
const Pong = defineChannel('pong');

class Responder {
  static inject = [PubSub];
  constructor(pubsub) {
    this.pubsub = pubsub;
  }
  onInit() {
    this.off = this.pubsub.on(Ping, () => this.pubsub.publish(Pong, { pid: process.pid }));
  }
  onShutdown() {
    this.off();
  }
}

await cluster(
  async () => {
    const live = defineController({
      inject: [PubSub],
      routes: (pubsub) => [
        { method: 'GET', path: '/live', handler: (ctx) => sse(ctx, (s) => pubsub.events(Pong, s)) },
        {
          method: 'POST',
          path: '/ping',
          handler: async () => {
            await pubsub.publish(Ping, {});
            return { pid: process.pid };
          },
        },
      ],
    });
    const app = createAvi({ logger: { error: (m, e) => console.error(m, e) } }).register({
      imports: [PubSub.module],
      providers: [Responder],
      controllers: [live],
    });
    await app.listen(0, '127.0.0.1');
    return app;
  },
  { workers: 2, logger: { error: (m) => console.error(m), warn: (m) => console.error(m) } },
);
