import nodeCluster from 'node:cluster';
import { memoryAdapter, type PubSubAdapter } from './adapter.js';

// Set by cluster() from @avijs/workers on the workers it forks; its primary relays messages.
const MARK = 'AVI_CLUSTER_WORKER';

interface Relayed {
  readonly avi: 'pubsub';
  readonly channel: string;
  readonly message: string;
}

function isRelayed(value: unknown): value is Relayed {
  const m = value as Partial<Relayed> | null;
  return (
    typeof m === 'object' &&
    m !== null &&
    m.avi === 'pubsub' &&
    typeof m.channel === 'string' &&
    typeof m.message === 'string'
  );
}

/**
 * Delivers to every worker of `cluster()` from `@avijs/workers`, through its primary process. No
 * extra server; one machine only. Outside a cluster, such as `avi dev`, it works in memory.
 */
export function clusterAdapter(): PubSubAdapter {
  if (!nodeCluster.isWorker) return memoryAdapter();
  if (!process.env[MARK]) {
    throw new Error(
      'clusterAdapter() needs cluster() from @avijs/workers, whose primary passes messages on',
    );
  }
  return {
    connect(deliver) {
      const onMessage = (value: unknown) => {
        if (isRelayed(value)) deliver(value.channel, value.message);
      };
      process.on('message', onMessage);
      return {
        publish(channel, message) {
          const relayed: Relayed = { avi: 'pubsub', channel, message };
          if (!process.send || !process.connected) {
            return Promise.reject(new Error('Not connected to the cluster primary'));
          }
          const send = process.send.bind(process);
          return new Promise<void>((resolve, reject) => {
            send(relayed, undefined, {}, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        },
        subscribe: () => undefined,
        unsubscribe: () => undefined,
        close() {
          process.off('message', onMessage);
        },
      };
    },
  };
}
