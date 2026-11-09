import {
  defineModule,
  type AviModule,
  type FactoryProvider,
  type InjectionToken,
  type Jsonify,
} from '@avijs/core';
import { memoryAdapter, type PubSubAdapter, type PubSubConnection } from './adapter.js';
import { channelName, type Channel } from './channel.js';

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/**
 * A message as subscribers receive it: parsed from JSON (a `Date` is a string) and frozen, as
 * every listener in the process shares it.
 */
export type Received<T> = DeepReadonly<Jsonify<T>>;

export interface SubscribeOptions {
  /** Messages kept for a reader that falls behind. Default: the `definePubSub` buffer. */
  buffer?: number;
}

export interface EventsOptions extends SubscribeOptions {
  /** The SSE event name, for `addEventListener(name)` in the browser. Default: none (`message`). */
  event?: string;
}

/** A message as an `sse()` event. */
export interface ChannelEvent<T> {
  readonly event?: string;
  readonly data: T;
}

/** Publishes to channels and listens to them, in this process and wherever the adapter reaches. */
export interface PubSub {
  /** Sends `data` as JSON. Resolves once the adapter has taken it. */
  publish<T>(channel: Channel<T>, data: NoInfer<T>): Promise<void>;
  /**
   * Messages from now on, until `signal` aborts or the app shuts down. A reader that falls
   * `buffer` messages behind gets a `SubscriptionOverflowError`.
   */
  subscribe<T>(
    channel: Channel<T>,
    signal?: AbortSignal,
    options?: SubscribeOptions,
  ): AsyncIterableIterator<Received<T>>;
  /**
   * Like `subscribe`, with each message as an `sse()` event:
   * `sse(ctx, (signal) => pubsub.events(Tasks, signal))`.
   */
  events<T>(
    channel: Channel<T>,
    signal?: AbortSignal,
    options?: EventsOptions,
  ): AsyncIterableIterator<ChannelEvent<Received<T>>>;
  /** Calls `listener` for each message until the returned function is called. */
  on<T>(channel: Channel<T>, listener: (data: Received<T>) => unknown): () => void;
}

export interface PubSubOptions {
  /** Default: an in-memory broker per app, this process only. */
  adapter?: PubSubAdapter;
  /** Messages kept per subscription for a slow reader. Default: 1 000. */
  buffer?: number;
  /** Malformed messages, failing listeners and adapter errors. Default: `console.error`. */
  onError?: (error: unknown) => void;
  /** Name of the token in errors and manifests. Default: `PubSub`. */
  name?: string;
}

/** A pub/sub token: inject it like any other, register it with `.module` or `.provider`. */
export interface PubSubToken extends InjectionToken<PubSub> {
  /** A module that provides and exports it. Import it wherever pub/sub is needed. */
  readonly module: AviModule;
  /** The provider alone, for registering it yourself. */
  readonly provider: FactoryProvider<PubSub>;
}

/** Thrown to a subscriber that fell too far behind. Subscribing again starts from new messages. */
export class SubscriptionOverflowError extends Error {
  constructor(channel: string, buffer: number) {
    super(`A subscriber to "${channel}" fell ${String(buffer)} messages behind and was dropped`);
    this.name = 'SubscriptionOverflowError';
  }
}

export function definePubSub(options: PubSubOptions = {}): PubSubToken {
  const { adapter } = options;
  if (
    adapter !== undefined &&
    typeof (adapter as Partial<PubSubAdapter> | null)?.connect !== 'function'
  ) {
    throw new TypeError('definePubSub: adapter must have a connect() method');
  }
  const buffer = checkBuffer(options.buffer ?? 1000, 'definePubSub buffer');
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error(error);
    });
  const name = options.name ?? 'PubSub';

  const token = { description: name } as { -readonly [K in keyof PubSubToken]: PubSubToken[K] };
  token.provider = {
    provide: token,
    // Without an adapter, each app gets its own broker, so apps never hear each other.
    useFactory: () => Broker.connect(adapter ?? memoryAdapter(), buffer, onError),
    // Ends subscriptions so streams finish; publishing works until dispose.
    onShutdown: (pubsub) => {
      (pubsub as Broker).stop();
    },
    dispose: (pubsub) => (pubsub as Broker).close(),
  };
  token.module = defineModule({
    name: `${name}Module`,
    providers: [token.provider],
    exports: [token],
  });
  return Object.freeze(token);
}

function checkBuffer(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`${where} must be a positive integer, got ${String(value)}`);
  }
  return value;
}

interface Listener {
  receive(data: unknown): void;
  end(error?: unknown): void;
}

interface Waiter {
  resolve(result: IteratorResult<never>): void;
  reject(error: unknown): void;
}

class Broker implements PubSub {
  readonly #channels = new Map<string, Set<Listener>>();
  // The adapter's subscribe and unsubscribe calls, one at a time per channel.
  readonly #pending = new Map<string, Promise<void>>();
  // Channels the adapter is subscribed to.
  readonly #subscribed = new Set<string>();
  readonly #buffer: number;
  readonly #onError: (error: unknown) => void;
  #connection!: PubSubConnection;
  #state: 'open' | 'stopped' | 'closed' = 'open';

  private constructor(buffer: number, onError: (error: unknown) => void) {
    this.#buffer = buffer;
    this.#onError = onError;
  }

  static async connect(
    adapter: PubSubAdapter,
    buffer: number,
    onError: (error: unknown) => void,
  ): Promise<Broker> {
    const broker = new Broker(buffer, onError);
    broker.#connection = await adapter.connect((channel, message) => {
      broker.#deliver(channel, message);
    });
    return broker;
  }

  async publish<T>(channel: Channel<T>, data: NoInfer<T>): Promise<void> {
    const name = channelName(channel, 'publish');
    if (this.#state === 'closed') throw new Error('Cannot publish: the app has closed');
    let text: unknown;
    try {
      text = JSON.stringify(data);
    } catch (error) {
      // A BigInt or a cycle.
      throw new TypeError(`Cannot publish to "${name}": data is not JSON`, { cause: error });
    }
    // undefined for a function or undefined itself.
    if (typeof text !== 'string') {
      throw new TypeError(`Cannot publish to "${name}": data is not JSON`);
    }
    await this.#connection.publish(name, text);
  }

  subscribe<T>(
    channel: Channel<T>,
    signal?: AbortSignal,
    options: SubscribeOptions = {},
  ): AsyncIterableIterator<Received<T>> {
    const name = channelName(channel, 'subscribe');
    const limit =
      options.buffer === undefined ? this.#buffer : checkBuffer(options.buffer, 'subscribe buffer');
    const queue: unknown[] = [];
    // Several next() calls may wait at once; they are answered in order.
    const waiting: Waiter[] = [];
    let done = false;
    let failure: { error: Error } | undefined;

    const listener: Listener = {
      receive: (data) => {
        if (done) return;
        const waiter = waiting.shift();
        if (waiter) waiter.resolve({ value: data as never, done: false });
        else if (queue.length >= limit) listener.end(new SubscriptionOverflowError(name, limit));
        else queue.push(data);
      },
      end: (error) => {
        if (done) return;
        done = true;
        signal?.removeEventListener('abort', onAbort);
        this.#remove(name, listener);
        // Like return(): an ended subscription yields nothing more.
        queue.length = 0;
        if (error !== undefined) failure = { error: asError(error) };
        for (const waiter of waiting.splice(0)) {
          if (failure) {
            waiter.reject(failure.error);
            failure = undefined;
          } else {
            waiter.resolve({ value: undefined as never, done: true });
          }
        }
      },
    };
    const onAbort = () => {
      listener.end();
    };

    if (signal?.aborted || this.#state !== 'open') done = true;
    else {
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#add(name, listener);
    }

    const iterator: AsyncIterableIterator<Received<T>> = {
      next: () => {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift() as Received<T>, done: false });
        }
        if (failure) {
          const { error } = failure;
          failure = undefined;
          return Promise.reject(error);
        }
        if (done) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<Received<T>>>((resolve, reject) => {
          waiting.push({ resolve, reject });
        });
      },
      return: () => {
        listener.end();
        queue.length = 0;
        failure = undefined;
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() {
        return iterator;
      },
    };
    return iterator;
  }

  events<T>(
    channel: Channel<T>,
    signal?: AbortSignal,
    options: EventsOptions = {},
  ): AsyncIterableIterator<ChannelEvent<Received<T>>> {
    const { event, ...rest } = options;
    if (event !== undefined && (typeof event !== 'string' || /[\r\n\0]/.test(event))) {
      throw new TypeError('events: event must be a string without line breaks');
    }
    // Subscribes now, like subscribe(), not on the first read.
    const source = this.subscribe(channel, signal, rest);
    const wrap = (data: Received<T>): ChannelEvent<Received<T>> =>
      event === undefined ? { data } : { event, data };
    const iterator: AsyncIterableIterator<ChannelEvent<Received<T>>> = {
      next: async () => {
        const result = await source.next();
        return result.done ? result : { value: wrap(result.value), done: false };
      },
      return: async () => {
        await source.return?.();
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]() {
        return iterator;
      },
    };
    return iterator;
  }

  on<T>(channel: Channel<T>, listener: (data: Received<T>) => unknown): () => void {
    const name = channelName(channel, 'on');
    if (typeof listener !== 'function') throw new TypeError('on() needs a listener function');
    if (this.#state !== 'open') return () => undefined;
    let done = false;
    const entry: Listener = {
      receive: (data) => {
        if (done) return;
        try {
          const result = listener(data as Received<T>);
          if (result instanceof Promise) {
            result.catch((error: unknown) => {
              this.#report(error);
            });
          }
        } catch (error) {
          this.#report(error);
        }
      },
      end: () => {
        done = true;
        this.#remove(name, entry);
      },
    };
    this.#add(name, entry);
    return () => {
      entry.end();
    };
  }

  /**
   * Ends every subscription; new ones end at once. Publishing still works. Does not wait for the
   * adapter: a broker that is down must not hold up app.close().
   */
  stop(): void {
    if (this.#state !== 'open') return;
    this.#state = 'stopped';
    for (const listeners of [...this.#channels.values()]) {
      for (const listener of [...listeners]) listener.end();
    }
  }

  async close(): Promise<void> {
    this.stop();
    if (this.#state === 'closed') return;
    this.#state = 'closed';
    await this.#connection.close();
  }

  #deliver(channel: string, message: string): void {
    const listeners = this.#channels.get(channel);
    if (!listeners || listeners.size === 0) return;
    let data: unknown;
    try {
      data = deepFreeze(JSON.parse(message));
    } catch (error) {
      this.#report(
        new Error(`Dropped a message on "${channel}" that is not JSON`, { cause: error }),
      );
      return;
    }
    for (const listener of [...listeners]) listener.receive(data);
  }

  #add(channel: string, listener: Listener): void {
    let listeners = this.#channels.get(channel);
    if (!listeners) {
      this.#channels.set(channel, (listeners = new Set()));
      this.#sync(channel, listeners);
    }
    listeners.add(listener);
  }

  #remove(channel: string, listener: Listener): void {
    const listeners = this.#channels.get(channel);
    if (!listeners?.delete(listener) || listeners.size > 0) return;
    this.#channels.delete(channel);
    this.#sync(channel);
  }

  // Steps run one at a time per channel. Each brings the adapter in line with the listeners at
  // that moment, so a quick leave and rejoin sends nothing and misses nothing.
  #sync(channel: string, joined?: Set<Listener>): void {
    const previous = this.#pending.get(channel) ?? Promise.resolve();
    const next = previous
      .then(() => this.#syncNow(channel, joined))
      .finally(() => {
        if (this.#pending.get(channel) === next) this.#pending.delete(channel);
      });
    this.#pending.set(channel, next);
  }

  async #syncNow(channel: string, joined: Set<Listener> | undefined): Promise<void> {
    if (this.#state === 'closed') return;
    const listeners = this.#channels.get(channel);
    const wanted = listeners !== undefined;
    if (wanted === this.#subscribed.has(channel)) return;
    try {
      if (wanted) {
        await this.#connection.subscribe(channel);
        this.#subscribed.add(channel);
      } else {
        this.#subscribed.delete(channel);
        await this.#connection.unsubscribe(channel);
      }
    } catch (error) {
      this.#report(error);
      // Nothing would arrive; end the subscribers this step was for rather than leave them
      // waiting. Others that joined since have a step of their own, which tries again.
      if (wanted && listeners === joined) {
        for (const each of [...listeners]) each.end(error);
      }
    }
  }

  // A throwing onError must not break delivery or shutdown.
  #report(error: unknown): void {
    try {
      this.#onError(error);
    } catch {
      // Nowhere left to report it.
    }
  }
}

// Every listener gets the same parsed value; freezing keeps one from changing it for the others.
// A loop, not recursion: JSON.parse accepts nesting deeper than the call stack.
function deepFreeze(value: unknown): unknown {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === 'object' && item !== null && !Object.isFrozen(item)) {
      Object.freeze(item);
      for (const child of Object.values(item)) stack.push(child);
    }
  }
  return value;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
