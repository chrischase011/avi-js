import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAvi, defineController, sse, type AviApp, type Context } from '@avijs/core';
import {
  defineChannel,
  definePubSub,
  memoryAdapter,
  SubscriptionOverflowError,
  type Deliver,
  type PubSub,
  type PubSubAdapter,
  type PubSubToken,
} from '../src/index.js';

const Tasks = defineChannel<{ id: number; at?: Date }>('tasks');
const Other = defineChannel<string>('other');

let app: AviApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(token: PubSubToken = definePubSub()): Promise<PubSub> {
  app = createAvi().register({ imports: [token.module] });
  await app.init();
  return app.get(token);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('definePubSub', () => {
  it('delivers published messages to every subscriber of the channel only', async () => {
    const pubsub = await start();
    const a = pubsub.subscribe(Tasks);
    const b = pubsub.subscribe(Tasks);
    const other = vi.fn();
    pubsub.on(Other, other);

    await pubsub.publish(Tasks, { id: 1 });
    await pubsub.publish(Tasks, { id: 2 });
    expect(await a.next()).toEqual({ value: { id: 1 }, done: false });
    expect(await a.next()).toEqual({ value: { id: 2 }, done: false });
    expect(await b.next()).toEqual({ value: { id: 1 }, done: false });
    expect(other).not.toHaveBeenCalled();
  });

  it('sends JSON: dates arrive as strings, and every listener gets one frozen copy', async () => {
    const pubsub = await start();
    const seen: unknown[] = [];
    pubsub.on(Tasks, (data) => seen.push(data));
    pubsub.on(Tasks, (data) => seen.push(data));
    await pubsub.publish(Tasks, { id: 1, at: new Date(0) });
    await tick();
    expect(seen[0]).toEqual({ id: 1, at: '1970-01-01T00:00:00.000Z' });
    expect(seen[0]).toBe(seen[1]);
    expect(Object.isFrozen(seen[0])).toBe(true);
    await expect(pubsub.publish(Other, undefined as never)).rejects.toThrow(
      'Cannot publish to "other": data is not JSON',
    );
  });

  it('starts a subscription when subscribe() is called, not on the first read', async () => {
    const pubsub = await start();
    const events = pubsub.subscribe(Tasks);
    await pubsub.publish(Tasks, { id: 1 });
    await tick();
    expect(await events.next()).toEqual({ value: { id: 1 }, done: false });
  });

  it('ends a subscription when its signal aborts, or on return()', async () => {
    const pubsub = await start();
    const controller = new AbortController();
    const events = pubsub.subscribe(Tasks, controller.signal);
    const pending = events.next();
    controller.abort();
    expect(await pending).toEqual({ value: undefined, done: true });

    const aborted = pubsub.subscribe(Tasks, AbortSignal.abort());
    expect(await aborted.next()).toEqual({ value: undefined, done: true });

    const listener = vi.fn();
    const off = pubsub.on(Tasks, listener);
    const loop = (async () => {
      const seen: unknown[] = [];
      for await (const task of pubsub.subscribe(Tasks)) {
        seen.push(task);
        break;
      }
      return seen;
    })();
    await tick();
    await pubsub.publish(Tasks, { id: 3 });
    expect(await loop).toEqual([{ id: 3 }]);
    off();
    await pubsub.publish(Tasks, { id: 4 });
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('drops a subscriber that falls behind its buffer', async () => {
    const pubsub = await start(definePubSub({ buffer: 2 }));
    const slow = pubsub.subscribe(Tasks);
    const roomy = pubsub.subscribe(Tasks, undefined, { buffer: 10 });
    for (const id of [1, 2, 3]) await pubsub.publish(Tasks, { id });
    await tick();
    await expect(slow.next()).rejects.toBeInstanceOf(SubscriptionOverflowError);
    await expect(slow.next()).resolves.toEqual({ value: undefined, done: true });
    expect(await roomy.next()).toEqual({ value: { id: 1 }, done: false });
  });

  it('reports failing listeners and malformed messages, and keeps going', async () => {
    const onError = vi.fn();
    let deliver!: (channel: string, message: string) => void;
    const adapter: PubSubAdapter = {
      connect(d) {
        deliver = d;
        return {
          publish: (channel, message) => {
            deliver(channel, message);
          },
          subscribe: () => undefined,
          unsubscribe: () => undefined,
          close: () => undefined,
        };
      },
    };
    const pubsub = await start(definePubSub({ adapter, onError }));
    const good = vi.fn();
    pubsub.on(Tasks, () => {
      throw new Error('listener broke');
    });
    pubsub.on(Tasks, async () => {
      await Promise.resolve();
      throw new Error('async listener broke');
    });
    pubsub.on(Tasks, good);
    deliver('tasks', '{not json');
    await pubsub.publish(Tasks, { id: 1 });
    await tick();
    expect(good).toHaveBeenCalledWith({ id: 1 });
    expect(onError.mock.calls.map(([e]) => (e as Error).message)).toEqual([
      'Dropped a message on "tasks" that is not JSON',
      'listener broke',
      'async listener broke',
    ]);
  });

  it('subscribes to the adapter once per channel, skipping a leave and quick rejoin', async () => {
    const calls: string[] = [];
    const adapter: PubSubAdapter = {
      connect: () => ({
        publish: () => undefined,
        subscribe: async (channel) => {
          await tick();
          calls.push(`+${channel}`);
        },
        unsubscribe: (channel) => {
          calls.push(`-${channel}`);
        },
        close: () => {
          calls.push('close');
        },
      }),
    };
    const pubsub = await start(definePubSub({ adapter }));
    const off1 = pubsub.on(Tasks, () => undefined);
    const off2 = pubsub.on(Tasks, () => undefined);
    off1();
    off2();
    // Rejoined before the adapter heard of the leave: nothing to send, nothing missed.
    const off3 = pubsub.on(Tasks, () => undefined);
    for (let i = 0; i < 5; i++) await tick();
    expect(calls).toEqual(['+tasks']);
    off3();
    for (let i = 0; i < 5; i++) await tick();
    pubsub.on(Tasks, () => undefined);
    for (let i = 0; i < 20 && calls.length < 3; i++) await tick();
    expect(calls).toEqual(['+tasks', '-tasks', '+tasks']);
    await app?.close();
    app = undefined;
    expect(calls).toEqual(['+tasks', '-tasks', '+tasks', '-tasks', 'close']);
  });

  it('ends the subscribers of a channel the adapter cannot subscribe to', async () => {
    const onError = vi.fn();
    const adapter: PubSubAdapter = {
      connect: () => ({
        publish: () => undefined,
        subscribe: () => Promise.reject(new Error('NOPERM')),
        unsubscribe: () => undefined,
        close: () => undefined,
      }),
    };
    const pubsub = await start(definePubSub({ adapter, onError }));
    await expect(pubsub.subscribe(Tasks).next()).rejects.toThrow('NOPERM');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'NOPERM' }));
  });

  it('reports no adapter failure that settles after the app has closed', async () => {
    const onError = vi.fn();
    let fail: (error: Error) => void = () => undefined;
    const adapter: PubSubAdapter = {
      connect: () => ({
        publish: () => undefined,
        subscribe: () => undefined,
        unsubscribe: () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
        close: () => undefined,
      }),
    };
    const pubsub = await start(definePubSub({ adapter, onError }));
    const stop = pubsub.on(Tasks, () => undefined);
    await tick();
    stop();
    await tick();
    await app?.close();
    app = undefined;
    fail(new Error('connection lost'));
    await tick();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ends subscriptions on shutdown but publishes until the app has closed', async () => {
    const token = definePubSub();
    app = createAvi().register({ imports: [token.module] });
    await app.init();
    const pubsub = app.get(token);
    const events = pubsub.subscribe(Tasks);
    const pending = events.next();
    const closing = app.close();
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(await pubsub.subscribe(Tasks).next()).toEqual({ value: undefined, done: true });
    await closing;
    app = undefined;
    await expect(pubsub.publish(Tasks, { id: 1 })).rejects.toThrow(
      'Cannot publish: the app has closed',
    );
  });

  it('shares one memory adapter between apps, like one broker', async () => {
    const adapter = memoryAdapter();
    const one = definePubSub({ adapter });
    const two = definePubSub({ adapter });
    const appOne = createAvi().register({ imports: [one.module] });
    const appTwo = createAvi().register({ imports: [two.module] });
    await Promise.all([appOne.init(), appTwo.init()]);
    const events = appTwo.get(two).subscribe(Tasks);
    await appOne.get(one).publish(Tasks, { id: 7 });
    expect(await events.next()).toEqual({ value: { id: 7 }, done: false });
    await Promise.all([appOne.close(), appTwo.close()]);
  });

  it('streams a channel over sse() and ends the stream on close', async () => {
    const token = definePubSub();
    const live = defineController({
      inject: [token],
      routes: (pubsub) => [
        {
          method: 'GET',
          path: '/live',
          handler: (ctx: Context) =>
            sse(ctx, (signal) => pubsub.events(Tasks, signal, { event: 'task' })),
        },
        {
          method: 'POST',
          path: '/tasks',
          handler: async () => {
            await pubsub.publish(Tasks, { id: 1 });
            return { ok: true };
          },
        },
      ],
    });
    app = createAvi({ shutdownTimeout: 10_000 }).register({
      imports: [token.module],
      controllers: [live],
    });
    const { port } = await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${String(port)}`;
    const res = await fetch(`${url}/live`);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    await fetch(`${url}/tasks`, { method: 'POST' });
    while (!text.includes('event: task\ndata: {"id":1}\n\n'))
      text += decoder.decode((await reader.read()).value);

    const started = performance.now();
    await app.close();
    app = undefined;
    expect(performance.now() - started).toBeLessThan(2000);
    expect((await reader.read()).done).toBe(true);
  });

  it('wraps messages as sse() events', async () => {
    const pubsub = await start();
    const plain = pubsub.events(Tasks);
    const named = pubsub.events(Tasks, undefined, { event: 'task' });
    await pubsub.publish(Tasks, { id: 1 });
    expect(await plain.next()).toEqual({ value: { data: { id: 1 } }, done: false });
    expect(await named.next()).toEqual({ value: { event: 'task', data: { id: 1 } }, done: false });
    expect(await named.return?.()).toEqual({ value: undefined, done: true });
    expect(await named.next()).toEqual({ value: undefined, done: true });
    expect(() => pubsub.events(Tasks, undefined, { event: 'a\nb' })).toThrow(
      'events: event must be a string without line breaks',
    );
  });

  it('gives each app its own broker when no adapter is set', async () => {
    const token = definePubSub();
    const appOne = createAvi().register({ imports: [token.module] });
    const appTwo = createAvi().register({ imports: [token.module] });
    await Promise.all([appOne.init(), appTwo.init()]);
    const heard = vi.fn();
    appTwo.get(token).on(Tasks, heard);
    await appOne.get(token).publish(Tasks, { id: 1 });
    await tick();
    expect(heard).not.toHaveBeenCalled();
    await Promise.all([appOne.close(), appTwo.close()]);
  });

  it('answers several waiting next() calls in order', async () => {
    const pubsub = await start();
    const events = pubsub.subscribe(Tasks);
    const first = events.next();
    const second = events.next();
    await pubsub.publish(Tasks, { id: 1 });
    await pubsub.publish(Tasks, { id: 2 });
    expect(await first).toEqual({ value: { id: 1 }, done: false });
    expect(await second).toEqual({ value: { id: 2 }, done: false });
    const third = events.next();
    const fourth = events.next();
    await events.return?.();
    expect(await third).toEqual({ value: undefined, done: true });
    expect(await fourth).toEqual({ value: undefined, done: true });
  });

  it('ends only the subscribers a failed subscribe was for', async () => {
    let calls = 0;
    const adapter: PubSubAdapter = {
      connect: () => ({
        publish: () => undefined,
        subscribe: async () => {
          calls++;
          if (calls === 1) {
            await tick();
            throw new Error('first subscribe failed');
          }
        },
        unsubscribe: () => undefined,
        close: () => undefined,
      }),
    };
    const pubsub = await start(
      definePubSub({
        adapter,
        onError: () => {
          throw new Error('onError itself fails');
        },
      }),
    );
    const early = pubsub.subscribe(Tasks);
    const failed = early.next();
    await early.return?.();
    const later = pubsub.subscribe(Tasks);
    const pending = later.next();
    await expect(failed).resolves.toEqual({ value: undefined, done: true });
    await tick();
    await tick();
    expect(calls).toBe(2);
    await later.return?.();
    expect(await pending).toEqual({ value: undefined, done: true });
  });

  it('validates its input', async () => {
    expect(() => defineChannel('')).toThrow('defineChannel needs a non-empty name');
    expect(() => definePubSub({ buffer: 0 })).toThrow(
      'definePubSub buffer must be a positive integer, got 0',
    );
    expect(() => definePubSub({ adapter: {} as PubSubAdapter })).toThrow(
      'definePubSub: adapter must have a connect() method',
    );
    const pubsub = await start();
    expect(() => pubsub.subscribe({} as typeof Tasks)).toThrow(
      'subscribe needs a channel from defineChannel()',
    );
    expect(() => pubsub.subscribe(Tasks, undefined, { buffer: -1 })).toThrow(RangeError);
  });
});

describe('definePubSub edge cases', () => {
  it('does not call an on() listener removed during the same delivery', async () => {
    const pubsub = await start();
    const calls: string[] = [];
    let offB = () => undefined as unknown;
    pubsub.on(Tasks, () => {
      calls.push('A');
      offB();
    });
    offB = pubsub.on(Tasks, () => calls.push('B'));
    await pubsub.publish(Tasks, { id: 1 });
    await tick();
    expect(calls).toEqual(['A']);
  });

  it('delivers JSON nested deeper than the call stack, as another publisher may send', async () => {
    let deliver: Deliver = () => undefined;
    const adapter: PubSubAdapter = {
      connect: (d) => {
        deliver = d;
        return {
          publish: () => undefined,
          subscribe: () => undefined,
          unsubscribe: () => undefined,
          close: () => undefined,
        };
      },
    };
    const pubsub = await start(definePubSub({ adapter }));
    const events = pubsub.subscribe(Other);
    await tick();
    deliver('other', '['.repeat(20_000) + ']'.repeat(20_000));
    const value: unknown = (await events.next()).value;
    expect(Array.isArray(value)).toBe(true);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('yields nothing more once the signal aborts, buffered messages included', async () => {
    const pubsub = await start();
    const controller = new AbortController();
    const events = pubsub.subscribe(Tasks, controller.signal);
    await pubsub.publish(Tasks, { id: 1 });
    await tick();
    controller.abort();
    expect(await events.next()).toEqual({ value: undefined, done: true });
  });

  it('rejects data JSON cannot hold with the channel name', async () => {
    const pubsub = await start();
    await expect(pubsub.publish(Tasks, { id: 1n } as never)).rejects.toThrow(
      'Cannot publish to "tasks": data is not JSON',
    );
  });

  it('does not hold up app.close() on an adapter that never answers', async () => {
    const adapter: PubSubAdapter = {
      connect: () => ({
        publish: () => undefined,
        subscribe: () => new Promise(() => undefined),
        unsubscribe: () => new Promise(() => undefined),
        close: () => undefined,
      }),
    };
    const pubsub = await start(definePubSub({ adapter }));
    pubsub.on(Tasks, () => undefined);
    await tick();
    await app?.close();
    app = undefined;
  });
});
