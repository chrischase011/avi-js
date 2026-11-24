# 19. WebSockets

> **Status: Runnable from 1.2.0. Experimental:** the API may still change in a 1.x minor release
> ([chapter 17](17-stability.md)).

[Server-sent events](07-production.md#server-sent-events) push from the server to the browser.
For messages both ways, such as a chat, use a WebSocket. With `@avijs/websocket`, a WebSocket
endpoint is an ordinary `GET` route: guards, middleware, request hooks, dependency injection and
params work as on any other route.

```sh
npm install @avijs/websocket
```

## A first socket

Return `websocket(ctx, handler)` from a route. The handler gets the connection once it is open:

```ts
// src/modules/echo/echo.controller.ts
import { Controller, Get, type Context } from '@avijs/core';
import { websocket } from '@avijs/websocket';

@Controller('/echo')
export class EchoController {
  @Get('/')
  connect(ctx: Context) {
    return websocket(ctx, async (socket) => {
      for await (const message of socket) {
        await socket.send(`echo: ${String(message)}`);
      }
    });
  }
}
```

```js
// In the browser
const ws = new WebSocket('ws://localhost:3000/echo');
ws.onmessage = (e) => console.log(e.data);
ws.onopen = () => ws.send('hello');
```

Iterating the socket gives each message: text as a string, binary as a `Uint8Array`. The loop ends
when the connection closes. A plain `GET` to the route, without the WebSocket handshake, gets
`426 Upgrade Required`.

| Member                          | Does                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| `for await (const m of socket)` | The client's messages, in order. A socket can be iterated once. |
| `send(data)`                    | Strings as text, bytes as binary, anything else as JSON.        |
| `close(code?, reason?)`         | Closes the connection; the default code is `1000`.              |
| `signal`                        | Aborts when the connection closes, from either side.            |
| `protocol`                      | The subprotocol agreed on (see `protocols` below), or `''`.     |
| `raw`                           | The [`ws`](https://github.com/websockets/ws) socket underneath. |

`send()` resolves once the message is written. Awaiting it keeps a slow client from piling up
messages in memory. Once the connection has closed, `send()` does nothing.

The connection stays open until the client or your code closes it; the handler returning does not
close it. Breaking out of the loop stops reading: later messages are dropped. If the handler
throws, the connection closes with code `1011` and the error is logged.

## Typed messages

Pass a [schema](06-validation.md) as `message`, and each message is parsed as JSON and checked
before your loop sees it:

```ts
import * as v from 'valibot';

const ChatMessage = v.object({ text: v.pipe(v.string(), v.maxLength(500)) });

@Get('/')
connect(ctx: Context) {
  return websocket(
    ctx,
    async (socket) => {
      for await (const message of socket) {
        // message is { text: string }
        await socket.send({ you: message.text });
      }
    },
    { message: ChatMessage },
  );
}
```

A message that is not JSON or fails the schema closes the connection with code `1007`; a binary
message closes it with `1003`. A client that sends bad data is either buggy or hostile, so the
server does not try to recover.

## Signing in

Guards run before the connection opens, so protect a socket like any route, with a guard such as
`signedIn` from [chapter 5](05-request-pipeline.md#guards):

```ts
@Get('/')
@UseGuards(signedIn)
connect(ctx: Context) {
  const user = ctx.need('user');
  return websocket(ctx, async (socket) => {
    await socket.send({ hello: user.name });
  });
}
```

A guard that refuses sends an ordinary response, such as `401`, and the browser's `onerror` fires.
Browsers cannot set headers such as `Authorization` on a WebSocket. Send the token in the query
string (`new WebSocket(`${url}?token=${token}`)`), in a cookie, or as the first message. Avi.js
never logs query strings, but proxies in front of it may.

Request-scoped providers are disposed once the route returns. Read what you need from them in the
route, before returning `websocket()`, not inside the handler.

## Origins

Any web page can open a WebSocket to any server, and the browser sends the user's cookies along.
CORS does not apply. So by default, `websocket()` refuses browser connections from pages served by
another host with `403`. Clients that send no `Origin` header, such as servers and command-line
tools, are always allowed.

List the origins of your frontends when they are served from somewhere else:

```ts
websocket(ctx, handler, { origins: ['https://app.example.com'] });
websocket(ctx, handler, { origins: (origin) => origin.endsWith('.example.com') });
websocket(ctx, handler, { origins: '*' }); // any page, for public sockets without cookies
```

In development, a Vite dev server on another port is another origin. Either list it
(`'http://localhost:5173'`), or proxy the socket through Vite (`ws: true`) without `changeOrigin`,
so the page and the socket share a host.

The default compares `Origin` with the request's `Host` header. That stops other sites, but not
DNS rebinding, where an attacker's domain points at your server and so matches its `Host`. That
matters for services on `localhost` or an internal network. A proxy that rewrites `Host` breaks the
comparison the other way and refuses your own pages. In production, list your origins.

## Broadcasting with pub/sub

A message often has to reach other clients: everyone in a chat room. Connections live in
different processes under [`cluster()`](16-workers.md) or on several servers, so publish through
[`@avijs/pubsub`](18-realtime.md). Each connection subscribes until it closes:

```ts
// src/modules/rooms/rooms.controller.ts
import { Controller, Get, UseGuards, type Context } from '@avijs/core';
import { websocket } from '@avijs/websocket';
import * as v from 'valibot';
import { ChatEvents, PubSub } from '../../pubsub.js';
import { signedIn } from '../auth/guards.js';

const Say = v.object({ text: v.pipe(v.string(), v.maxLength(500)) });

@Controller('/rooms')
export class RoomsController {
  constructor(private readonly pubsub: PubSub) {}

  @Get('/:room')
  @UseGuards(signedIn)
  join(ctx: Context<object, { room: string }>) {
    const room = ctx.params.room;
    const user = ctx.need('user');
    return websocket(
      ctx,
      async (socket) => {
        // Everything said in this room, from any process, until the socket closes.
        const broadcast = async () => {
          for await (const event of this.pubsub.subscribe(ChatEvents, socket.signal)) {
            if (event.room === room) await socket.send(event);
          }
        };
        const listen = async () => {
          for await (const message of socket) {
            await this.pubsub.publish(ChatEvents, { room, from: user.name, text: message.text });
          }
        };
        await Promise.all([broadcast(), listen()]);
      },
      { message: Say },
    );
  }
}
```

```ts
// src/pubsub.ts
export const ChatEvents = defineChannel<{ room: string; from: string; text: string }>('chat');
```

The subscription stops when `socket.signal` aborts, so nothing is left behind when a client
leaves. Run both loops through `Promise.all`, so an error in either reaches the handler: the
connection then closes with `1011` and the error is logged. A loop started with `void` and no
`catch` would turn the same error into an unhandled rejection, which stops the process. One example
is the `SubscriptionOverflowError` a subscription throws when a slow client falls far behind.

## Limits and shutdown

| Option       | Default            | Does                                                                                   |
| ------------ | ------------------ | -------------------------------------------------------------------------------------- |
| `maxPayload` | 1 MiB              | Larger messages close the connection with code `1009`.                                 |
| `heartbeat`  | `30_000` ms        | Pings this often; a client that missed the last ping is dropped. `false` turns it off. |
| `origins`    | the same host      | See [Origins](#origins).                                                               |
| `protocols`  | the client's first | Subprotocols you speak, in order of preference.                                        |
| `message`    | none               | A schema for [typed messages](#typed-messages).                                        |

While your loop is busy, up to 16 messages wait for it; after that the server stops reading from
the client until the loop catches up. A client is never dropped for missed pings during that time.
Before the handler starts iterating, the first 16 messages wait and later ones are dropped, so a
handler that only sends is not held up by a chatty client. Messages are not compressed.

A broken handshake, such as a missing `Sec-WebSocket-Key`, gets `400` before the handler runs,
with your `errorHandler` and `onResponse` like any refused request.

When the app shuts down, each connection is closed with code `1001` ("going away"), so clients
know to reconnect, possibly to another worker. Connections still open after `shutdownTimeout` are
destroyed. Requests to connect during shutdown get `503`.

## Testing

Connect to the app from a test with the `WebSocket` built into Node.js 22:

```ts
import { createTestClient, type TestClient } from '@avijs/testing';

let client: TestClient;
beforeEach(async () => {
  client = await createTestClient(AppModule);
});
afterEach(() => client.close());

it('echoes', async () => {
  const ws = new WebSocket(`${client.url.replace('http', 'ws')}/echo`);
  const reply = new Promise((resolve) => (ws.onmessage = (e) => resolve(e.data)));
  ws.onopen = () => ws.send('hi');
  expect(await reply).toBe('echo: hi');
  ws.close();
});
```

## Under the hood

`websocket()` runs on [`ws`](https://github.com/websockets/ws). For what the connection does not
cover, such as `ping()` with a payload, use `socket.raw`. It is `ws`'s own socket and is outside
the stability promise. Read it before iterating to handle message events yourself: Avi.js then
stops reading messages for you, and iterating the socket throws.

`websocket()` is built on `upgrade()` from `@avijs/core`, a low-level, experimental function that
accepts any upgrade protocol on a route. The older `onUpgrade` option of `createAvi`
([chapter 7](07-production.md#websockets)) still works, but it takes every upgrade request
before routing, so guards do not run and `websocket()` routes answer `426`. Use one or the other.
