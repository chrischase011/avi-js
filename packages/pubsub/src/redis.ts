import type { PubSubAdapter } from './adapter.js';

/** What `redisAdapter` uses of a `redis` (node-redis) client. */
export interface RedisClient {
  publish(channel: string, message: string): Promise<unknown>;
}

/** A node-redis client in subscriber mode, usually `client.duplicate()` after `connect()`. */
export interface RedisSubscriber {
  subscribe(
    channel: string,
    listener: (message: string, channel: string) => void,
  ): Promise<unknown>;
  unsubscribe(
    channel: string,
    listener: (message: string, channel: string) => void,
  ): Promise<unknown>;
}

/** What `ioredisAdapter` uses of an `ioredis` client. */
export interface IoRedisClient {
  publish(channel: string, message: string): Promise<unknown>;
}

/** An ioredis client used only for subscribing, usually `client.duplicate()`. */
export interface IoRedisSubscriber {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  off(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

export interface RedisAdapterOptions<P, S> {
  /** Publishes. Any connected client. */
  publisher: P;
  /** Subscribes. Needs its own connection: Redis allows only subscribe commands on it. */
  subscriber: S;
  /** Added to every channel name, to share one Redis server between apps. Default: none. */
  prefix?: string;
}

/**
 * Delivers through Redis pub/sub with the `redis` package, across processes and machines. Create
 * and connect the clients yourself; closing the app leaves them open.
 */
export function redisAdapter(
  options: RedisAdapterOptions<RedisClient, RedisSubscriber>,
): PubSubAdapter {
  const { publisher, subscriber, prefix = '' } = options;
  return {
    connect(deliver) {
      const subscribed = new Set<string>();
      const listener = (message: string, channel: string) => {
        if (channel.startsWith(prefix)) deliver(channel.slice(prefix.length), message);
      };
      return {
        async publish(channel, message) {
          await publisher.publish(prefix + channel, message);
        },
        async subscribe(channel) {
          subscribed.add(channel);
          await subscriber.subscribe(prefix + channel, listener);
        },
        async unsubscribe(channel) {
          subscribed.delete(channel);
          await subscriber.unsubscribe(prefix + channel, listener);
        },
        async close() {
          const channels = [...subscribed];
          subscribed.clear();
          await Promise.all(
            channels.map((channel) => subscriber.unsubscribe(prefix + channel, listener)),
          );
        },
      };
    },
  };
}

/** Like `redisAdapter`, for `ioredis` clients. */
export function ioredisAdapter(
  options: RedisAdapterOptions<IoRedisClient, IoRedisSubscriber>,
): PubSubAdapter {
  const { publisher, subscriber, prefix = '' } = options;
  return {
    connect(deliver) {
      const subscribed = new Set<string>();
      const listener = (channel: string, message: string) => {
        if (!channel.startsWith(prefix)) return;
        const name = channel.slice(prefix.length);
        // The client may also carry channels the app subscribed to itself.
        if (subscribed.has(name)) deliver(name, message);
      };
      subscriber.on('message', listener);
      return {
        async publish(channel, message) {
          await publisher.publish(prefix + channel, message);
        },
        async subscribe(channel) {
          subscribed.add(channel);
          await subscriber.subscribe(prefix + channel);
        },
        async unsubscribe(channel) {
          subscribed.delete(channel);
          await subscriber.unsubscribe(prefix + channel);
        },
        async close() {
          subscriber.off('message', listener);
          const channels = [...subscribed];
          subscribed.clear();
          await Promise.all(channels.map((channel) => subscriber.unsubscribe(prefix + channel)));
        },
      };
    },
  };
}
