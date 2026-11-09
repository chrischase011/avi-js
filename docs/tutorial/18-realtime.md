# 18. Real-time updates with pub/sub

> **Status: Runnable from 1.1.0.**

[Server-sent events](07-production.md#server-sent-events) push changes to the browser. Fed by an
in-memory `EventEmitter`, they only reach clients of the process that made the change. Under
[`cluster()`](16-workers.md), or with several servers, most clients miss most changes.

`@avijs/pubsub` publishes through a broker every process can hear: memory for one process, the
`cluster()` primary for one machine, Redis for several.

```sh
npm install @avijs/pubsub
```

## Set it up once

Define the pub/sub and its channels in one file. Each channel has a name and a message type:

```ts
// src/pubsub.ts
import type { TokenType } from '@avijs/core';
import { clusterAdapter, defineChannel, definePubSub } from '@avijs/pubsub';

export const PubSub = definePubSub({ adapter: clusterAdapter() });
export type PubSub = TokenType<typeof PubSub>;

export const UserEvents = defineChannel<{ type: 'created'; id: number; name: string }>('users');
```

`PubSub` works like a [config token](13-configuration.md): import `PubSub.module` wherever it is
needed and inject it. Define it once and import that constant everywhere: each `definePubSub()`
call is a separate pub/sub.

## Publish and stream

```ts
// src/modules/users/users.service.ts
@Injectable()
export class UsersService {
  private readonly users: { id: number; name: string }[] = [];
  private nextId = 1;

  constructor(private readonly pubsub: PubSub) {}

  async create(name: string) {
    const user = { id: this.nextId++, name };
    this.users.push(user);
    await this.pubsub.publish(UserEvents, { type: 'created', ...user });
    return user;
  }
}
```

```ts
// src/modules/users/users.controller.ts
@Controller('/users')
export class UsersController {
  constructor(private readonly pubsub: PubSub) {}

  @Get('/events')
  events(ctx: Context) {
    return sse(ctx, (signal) => this.pubsub.events(UserEvents, signal));
  }
}

@Module({ imports: [PubSub.module], controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
```

```js
// In the browser
new EventSource('/users/events').onmessage = (e) => console.log(JSON.parse(e.data));
```

`events()` turns each message into an `sse()` event. Pass `{ event: 'user' }` as the third argument
to name the events, for `addEventListener('user', ...)` in the browser.

| Method                                 | Gives                                                           |
| -------------------------------------- | --------------------------------------------------------------- |
| `publish(channel, data)`               | Sends `data` to every subscriber, in every process.             |
| `events(channel, signal, options?)`    | `{ data }` events for `sse()`.                                  |
| `subscribe(channel, signal, options?)` | The messages themselves, for `for await`.                       |
| `on(channel, listener)`                | Calls `listener` per message; returns a function that stops it. |

A subscription starts when `subscribe()` or `events()` is called and ends when `signal` aborts;
messages not read by then are dropped. Inside `sse()`, that is when the client leaves. With Redis, messages arrive once Redis has
confirmed the subscription, a moment later: a message published in between is not received.

## Listening without a request

`on()` suits work that is not tied to a request, such as clearing a cache. Start it in
[`onInit`](03-modules-and-di.md#lifecycle-hooks) and stop it in `onShutdown`:

```ts
@Injectable()
export class UserCache implements OnInit, OnShutdown {
  private readonly names = new Map<number, string>();
  private stop = () => {};

  constructor(private readonly pubsub: PubSub) {}

  onInit() {
    this.stop = this.pubsub.on(UserEvents, (event) => this.names.delete(event.id));
  }

  onShutdown() {
    this.stop();
  }
}
```

An error thrown by a listener is reported (see `onError` below) and does not affect other
listeners.

## Adapters

| Adapter            | Reaches                                           | Needs                 |
| ------------------ | ------------------------------------------------- | --------------------- |
| `memoryAdapter()`  | This process.                                     | Nothing               |
| `clusterAdapter()` | Every worker of `cluster()` on this machine.      | `@avijs/workers`      |
| `redisAdapter()`   | Every process connected to the same Redis server. | The `redis` package   |
| `ioredisAdapter()` | The same, with `ioredis`.                         | The `ioredis` package |

Without an adapter, each app gets its own in-memory broker, so two apps in one process (such as
parallel tests) never hear each other. Apps given the same `memoryAdapter()` share it, like apps on
one Redis server.

`clusterAdapter()` sends each message to the `cluster()` primary, which passes it to every worker.
Outside a cluster, such as under `avi dev` or with one worker, it works in memory, so the same code
runs everywhere. It reaches `cluster()` workers only: a [`runWorker()`](16-workers.md#background-workers-runworker) process or
a worker thread works in memory too, so use Redis to reach those. In a worker forked by something
other than `cluster()` it refuses to start.

For Redis, create and connect the clients yourself. A subscribing connection can only subscribe,
so it needs its own client:

```ts
import { createClient } from 'redis';
import { definePubSub, redisAdapter } from '@avijs/pubsub';

const publisher = createClient({ url: process.env.REDIS_URL });
const subscriber = publisher.duplicate();
await Promise.all([publisher.connect(), subscriber.connect()]);

export const PubSub = definePubSub({ adapter: redisAdapter({ publisher, subscriber }) });
```

```ts
import { Redis } from 'ioredis';
import { definePubSub, ioredisAdapter } from '@avijs/pubsub';

const publisher = new Redis(process.env.REDIS_URL);
const subscriber = publisher.duplicate();

export const PubSub = definePubSub({ adapter: ioredisAdapter({ publisher, subscriber }) });
```

Closing the app unsubscribes but leaves the clients open: they are yours to `quit()` after
`app.close()`. Apps may share the clients, as apps made from one module do in tests: each app's
channels are counted, and one app leaving a channel does not unsubscribe another. Don't subscribe
on the subscriber client outside Avi: Redis counts subscriptions per connection, so Avi could
unsubscribe a channel you also use. To share one Redis server between apps, set
`prefix: 'myapp:'`; it is added to every channel name.

## What a message is

- **JSON.** `publish` sends `JSON.stringify(data)`, so a `Date` arrives as a string. The types
  follow: a subscriber of `defineChannel<{ at: Date }>` receives `{ at: string }`. A `BigInt` or a
  cycle makes `publish` reject; `NaN` and `Infinity` arrive as `null`.
- **Shared and frozen.** Every listener in a process gets the same object, frozen so one cannot
  change it for the others. Its type is `Received<T>`: the JSON form, read-only.
- **Everyone hears it**, the publishing process included.
- **Only from now on.** A subscriber receives what is published after it subscribed; nothing is
  stored. A browser that reconnects has missed what was sent while it was away, so send the
  current state first, or let the page reload it.

## Slow readers

Each subscription keeps up to 1 000 messages for a reader that falls behind, such as a browser on
a slow network. One that falls further behind is dropped with a `SubscriptionOverflowError`, and
`sse()` closes its connection; `EventSource` reconnects by itself. Change the limit for all
subscriptions with `definePubSub({ buffer })`, or for one with `subscribe(channel, signal, { buffer })`.

## Shutdown

`app.close()` refuses new connections, then ends every subscription, so open `sse()` streams
finish and browsers reconnect. During a rolling `restart()` of `cluster()`, they reconnect to a
worker that stays up; when the whole app stops, they retry until it is back. Requests still in
flight can publish until the app has closed; after that, `publish` rejects.

## Errors

Messages that are not JSON, listeners that throw, and adapter failures go to `onError`, which
defaults to `console.error`:

```ts
definePubSub({ adapter, onError: (error) => logger.error('pubsub', error) });
```

When the adapter cannot subscribe to a channel, its subscribers end with that error instead of
waiting for messages that will never come. `on()` listeners are removed; the error reaches
`onError`, so call `on()` again to retry.

## Testing

Without an adapter, `definePubSub()` works in memory, so tests need no broker. When the app's
`PubSub` uses Redis, swap it for an in-memory one with
[overrides](08-testing.md#replacing-providers):

```ts
import { definePubSub } from '@avijs/pubsub';

client = await createTestClient(AppModule, {
  overrides: [{ ...definePubSub().provider, provide: PubSub }],
});
```

The test still imports `src/pubsub.ts`, which connects the Redis clients above, so `REDIS_URL` must
reach a server there too.

## Next

Coming from NestJS? See [Avi.js for NestJS developers](99-from-nestjs.md), or go back to the
[tutorial index](README.md).
