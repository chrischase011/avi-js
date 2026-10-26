# 1. Your first app

> **Status: Runnable.** Everything on this page works today. The code lives in
> `examples/basic-api`.

A small users API built with the explicit API: routes, a service, middleware and errors, run from
the repository and explained line by line.

## Run it

From the repository root:

```sh
pnpm build
pnpm --filter @avijs/example-basic-api start
```

```text
AVI.JS 1.0.0 · Application bootstrap

✓ 1 module loaded
✓ Dependency graph validated
✓ 5 routes registered
✓ HTTP server ready on http://localhost:3000

Startup completed in 3.2 ms
```

In another terminal:

```sh
curl localhost:3000/
# {"message":"Hello, Avi"}

curl localhost:3000/health
# ok

curl -i -X POST localhost:3000/users -H 'content-type: application/json' -d '{"name":"Grace"}'
# HTTP/1.1 201 Created
# location: /users/2
# {"id":2,"name":"Grace"}
```

Stop it with `Ctrl+C`. The app shuts down gracefully.

## The code

```ts
import { createAvi, defineController } from '@avijs/core';

const hello = defineController({
  routes: [
    { method: 'GET', path: '/', handler: () => ({ message: 'Hello, Avi' }) },
    { method: 'GET', path: '/health', handler: () => 'ok' },
  ],
});

const app = createAvi();
app.register({ controllers: [hello] });
await app.listen(3000);
```

- `defineController` groups routes under an optional `prefix` (default `/`).
- `register` adds controllers. Call it as often as you like before `listen`. Routes and
  dependencies are checked when the app starts, and `listen` rejects if something is wrong.
- `listen` resolves to the bound address. Pass port `0` to get a random free port.

## Return values become responses

There is no `res.send()`. A handler returns a value and Avi.js picks the response:

| Handler returns                          | Response                                 |
| ---------------------------------------- | ---------------------------------------- |
| object, array, number, boolean or `null` | `200`, `application/json; charset=utf-8` |
| string                                   | `200`, `text/plain; charset=utf-8`       |
| `Uint8Array` or `Buffer`                 | `200`, `application/octet-stream`        |
| `undefined`                              | `204 No Content`                         |
| a promise                                | awaited, then the rules above            |

Every response also carries `x-content-type-options: nosniff`.

## Status codes and headers: `reply()`

```ts
import { reply } from '@avijs/core';

{
  method: 'POST',
  path: '/',
  handler: () => reply({ id: 2 }, { status: 201, headers: { location: '/users/2' } }),
}
```

A `content-type` header you set wins over the default. `reply(undefined, { status: 202 })` sends
an empty `202`.

## Reading the request

The handler receives one argument, `ctx`:

| Field             | What it is                                                          |
| ----------------- | ------------------------------------------------------------------- |
| `ctx.method`      | `'GET'`, `'POST'`, …                                                |
| `ctx.path`        | The path without the query string                                   |
| `ctx.params`      | Route parameters, see [Chapter 2](02-routing.md)                    |
| `ctx.query`       | A `URLSearchParams`: `ctx.query.get('page')`                        |
| `ctx.headers`     | Request headers, lower-cased                                        |
| `ctx.signal`      | An `AbortSignal` that fires if the client disconnects               |
| `ctx.req`         | The raw Node.js `IncomingMessage`, as an escape hatch               |
| `ctx.state`       | Per-request data, see [Chapter 5](05-request-pipeline.md)           |
| `ctx.input`       | Validated params, query and body, see [Chapter 6](06-validation.md) |
| `ctx.setHeader()` | Adds a response header, see [Chapter 5](05-request-pipeline.md)     |
| `ctx.text()`      | Reads the body as UTF-8 text                                        |
| `ctx.json()`      | Reads and parses a JSON body                                        |

The body is only read when you call `text()` or `json()`, and only once. Calling either again
returns the same result.

```ts
{
  method: 'POST',
  path: '/',
  handler: async (ctx) => {
    const input = await ctx.json();
    if (typeof input !== 'object' || input === null || !('name' in input)) {
      throw new HttpError(400, 'Body must be an object with a name');
    }
    return reply({ id: 2, name: String(input.name) }, { status: 201 });
  },
}
```

`ctx.json()` returns `unknown`, so TypeScript makes you check the shape before using it. Schema
validation arrives in [Chapter 6](06-validation.md).

## Errors are safe by default

| What happens                                   | Client gets                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `throw new HttpError(404)`                     | `404 {"statusCode":404,"error":"Not Found","message":"Not Found"}` |
| `throw new HttpError(422, 'Name is required')` | `422` with that message                                            |
| `throw new HttpError(503, 'db-3 is down')`     | `503 {"statusCode":503,"error":"Service Unavailable"}`             |
| any other error, sync or async                 | `500 {"statusCode":500,"error":"Internal Server Error"}`           |
| `ctx.json()` with a non-JSON content type      | `415`                                                              |
| `ctx.json()` with malformed JSON               | `400`                                                              |
| a body larger than `bodyLimit`                 | `413`, and the connection is closed                                |
| no matching route                              | `404`                                                              |
| route exists for another method                | `405` with an `Allow` header                                       |

Messages from 4xx `HttpError`s reach the client. Messages from 5xx and unexpected errors never
do, in any environment. They go to the logger instead:

```ts
const app = createAvi({
  logger: { error: (message, error) => myLogger.error({ err: error }, message) },
});
```

## Options

```ts
createAvi({
  bodyLimit: 1024 * 1024, // bytes, default 1 MiB
  shutdownTimeout: 10_000, // ms close() waits for in-flight requests
  requestTimeout: 300_000, // passed to node:http
  headersTimeout: 60_000, // passed to node:http
  logger: console, // anything with error(message, error); see chapter 7 for JSON logs
});
```

## Shutting down

```ts
const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
```

`close()` stops accepting connections, closes idle keep-alive connections, lets in-flight
requests finish, and resolves. Requests still running after `shutdownTimeout` are cut off.
Avi.js does not install signal handlers for you.

## Next

[Chapter 2: Routing](02-routing.md).
