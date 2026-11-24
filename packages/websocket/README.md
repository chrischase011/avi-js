# @avijs/websocket

WebSocket routes for Avi.js. A WebSocket endpoint is an ordinary `GET` route, so guards,
middleware, dependency injection and params work as on any other route. Runs on
[`ws`](https://github.com/websockets/ws). Experimental: the API may change in a 1.x minor release.

```sh
npm install @avijs/websocket
```

```ts
import { Controller, Get, UseGuards, type Context } from '@avijs/core';
import { websocket } from '@avijs/websocket';

@Controller('/echo')
export class EchoController {
  @Get('/')
  @UseGuards(signedIn)
  connect(ctx: Context) {
    return websocket(ctx, async (socket) => {
      for await (const message of socket) await socket.send(`echo: ${String(message)}`);
    });
  }
}
```

Messages can be validated with any Standard Schema (`{ message: schema }`), browser origins are
checked by default, and connections close with code 1001 when the app shuts down.

Part of [Avi.js](https://github.com/chrischase011/avi-js), a TypeScript framework for Node.js with
modules, controllers and dependency injection, without `reflect-metadata`. See the
[WebSockets chapter](https://github.com/chrischase011/avi-js/blob/main/docs/tutorial/19-websockets.md)
of the tutorial.

Requires Node.js 22.12 or newer. MIT licensed.
