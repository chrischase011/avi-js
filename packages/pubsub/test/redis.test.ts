import { afterEach, describe, expect, it } from 'vitest';
import { createAvi, type AviApp } from '@avijs/core';
import {
  defineChannel,
  definePubSub,
  ioredisAdapter,
  redisAdapter,
  type IoRedisSubscriber,
  type RedisSubscriber,
} from '../src/index.js';

// Fakes with the calling conventions of each client, sharing one in-memory "server".
type Handler = (channel: string, message: string) => void;
function fakeServer() {
  const subscribers = new Map<string, Set<Handler>>();
  return {
    subscribers,
    publisher: {
      publish: (channel: string, message: string) => {
        for (const handler of subscribers.get(channel) ?? [])
          queueMicrotask(() => {
            handler(channel, message);
          });
        return Promise.resolve(1);
      },
    },
    add(channel: string, handler: Handler) {
      let set = subscribers.get(channel);
      if (!set) subscribers.set(channel, (set = new Set()));
      set.add(handler);
    },
    remove(channel: string, handler?: Handler) {
      if (handler) subscribers.get(channel)?.delete(handler);
      else subscribers.delete(channel);
      if (subscribers.get(channel)?.size === 0) subscribers.delete(channel);
    },
  };
}

function nodeRedisSubscriber(server: ReturnType<typeof fakeServer>): RedisSubscriber {
  const wrapped = new Map<unknown, Handler>();
  return {
    subscribe(channel, listener) {
      const handler: Handler = (ch, message) => {
        listener(message, ch);
      };
      wrapped.set(listener, handler);
      server.add(channel, handler);
      return Promise.resolve();
    },
    unsubscribe(channel, listener) {
      server.remove(channel, wrapped.get(listener));
      return Promise.resolve();
    },
  };
}

function ioredisSubscriber(server: ReturnType<typeof fakeServer>): IoRedisSubscriber {
  const listeners = new Set<Handler>();
  const emit: Handler = (channel, message) => {
    for (const listener of listeners) listener(channel, message);
  };
  return {
    subscribe: (channel) => (server.add(channel, emit), Promise.resolve(1)),
    unsubscribe: (channel) => (server.remove(channel, emit), Promise.resolve(1)),
    on: (_event, listener) => listeners.add(listener),
    off: (_event, listener) => listeners.delete(listener),
  };
}

const Tasks = defineChannel<{ id: number }>('tasks');
const apps: AviApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function connected(adapter: Parameters<typeof definePubSub>[0]) {
  const token = definePubSub(adapter);
  const app = createAvi().register({ imports: [token.module] });
  apps.push(app);
  await app.init();
  return app.get(token);
}

describe.each([
  ['redisAdapter', redisAdapter, nodeRedisSubscriber],
  ['ioredisAdapter', ioredisAdapter, ioredisSubscriber],
] as const)('%s', (_name, adapter, subscriber) => {
  it('delivers between two apps through the server, with a prefix', async () => {
    const server = fakeServer();
    const make = () =>
      connected({
        adapter: adapter({
          publisher: server.publisher,
          subscriber: subscriber(server) as never,
          prefix: 'shop:',
        }),
      });
    const [one, two] = await Promise.all([make(), make()]);
    const events = two.subscribe(Tasks);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect([...server.subscribers.keys()]).toEqual(['shop:tasks']);

    await one.publish(Tasks, { id: 1 });
    expect(await events.next()).toEqual({ value: { id: 1 }, done: false });

    await events.return?.();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(server.subscribers.size).toBe(0);
  });

  it('unsubscribes on close and leaves the clients to the app', async () => {
    const server = fakeServer();
    const pubsub = await connected({
      adapter: adapter({ publisher: server.publisher, subscriber: subscriber(server) as never }),
    });
    pubsub.on(Tasks, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect([...server.subscribers.keys()]).toEqual(['tasks']);
    await apps.pop()?.close();
    expect(server.subscribers.size).toBe(0);
  });
});

describe.each([
  ['redisAdapter', redisAdapter, nodeRedisSubscriber],
  ['ioredisAdapter', ioredisAdapter, ioredisSubscriber],
] as const)('%s with one subscriber client for two apps', (_name, adapter, subscriber) => {
  it('keeps delivering to one app after the other leaves the channel', async () => {
    const server = fakeServer();
    const shared = subscriber(server);
    const make = () =>
      connected({ adapter: adapter({ publisher: server.publisher, subscriber: shared as never }) });
    const [one, two] = await Promise.all([make(), make()]);
    const received: unknown[] = [];
    one.on(Tasks, (task) => received.push(task));
    const stop = two.on(Tasks, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    stop();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await two.publish(Tasks, { id: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(received).toEqual([{ id: 1 }]);
  });
});

it('does not hold up app.close() while Redis is down', async () => {
  const server = fakeServer();
  const stuck: IoRedisSubscriber = {
    ...ioredisSubscriber(server),
    subscribe: () => new Promise(() => undefined),
    unsubscribe: () => new Promise(() => undefined),
  };
  const pubsub = await connected({
    adapter: ioredisAdapter({ publisher: server.publisher, subscriber: stuck }),
  });
  pubsub.on(Tasks, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await apps.pop()?.close();
});
