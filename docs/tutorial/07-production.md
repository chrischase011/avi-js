# 7. Running in production

> **Status: Runnable.** Everything on this page works today.

What Avi.js does for you in production, and the settings that control it: body limits, safe
errors, client disconnects, graceful shutdown, timeouts and streaming.

These defaults are part of Avi.js from the start, not add-ons:

| Concern            | Default behavior                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Request bodies     | Limited to 1 MiB (`bodyLimit`). Oversized bodies get `413`, never read past it.                                    |
| Error responses    | Generic 5xx bodies in every environment. Details go to your logger.                                                |
| Client disconnects | `ctx.signal` aborts so handlers can stop work early; streams stop being read.                                      |
| Shutdown           | `app.close()` drains in-flight requests, forces after `shutdownTimeout`, then disposes providers in reverse order. |
| Slow clients       | `headersTimeout` and `requestTimeout` close connections that send too slowly.                                      |
| Malformed input    | Bad URL encodings get `400`; Node rejects broken HTTP and oversized headers (`431`).                               |
| Streaming          | Streamed responses respect backpressure from slow clients.                                                         |

## Streaming responses

Return a stream instead of a value. Avi.js sends it chunked, reads from it only as fast as the
client receives, and stops reading if the client disconnects:

```ts
import { createReadStream } from 'node:fs';
import { reply } from '@avijs/core';

route({
  method: 'GET',
  path: '/export.csv',
  handler: () =>
    reply(createReadStream('./export.csv'), {
      headers: { 'content-type': 'text/csv; charset=utf-8' },
    }),
});
```

Supported return values:

| Return                 | Sent as                                                         |
| ---------------------- | --------------------------------------------------------------- |
| a Node `Readable`      | chunked, `application/octet-stream` unless you set a type       |
| a web `ReadableStream` | the same                                                        |
| a web `Response`       | its status, headers and body; `ctx.setHeader` headers are added |

`HEAD` requests get the headers without reading the stream. If a stream fails after the response
has started, the status can no longer change: Avi.js logs the error and closes the connection, so
the client sees a truncated response instead of a silently wrong one.

## Server-sent events

For one-way live updates (progress, notifications, feeds), return `sse()` with a generator. Each
`yield` sends one event; the browser reads them with `EventSource`:

```ts
import { route, sse } from '@avijs/core';

route({
  method: 'GET',
  path: '/jobs/:id/progress',
  handler: (ctx) =>
    sse(ctx, async function* (signal) {
      for await (const step of jobs.watch(ctx.params.id, { signal })) {
        yield { event: 'progress', data: { step } };
      }
      yield { event: 'done', data: 'finished' };
    }),
});
```

```js
// In the browser
const events = new EventSource('/jobs/42/progress');
events.addEventListener('progress', (e) => console.log(JSON.parse(e.data)));
```

| Field   | Sent as                                                       |
| ------- | ------------------------------------------------------------- |
| `data`  | strings as is, anything else as JSON; line breaks are safe    |
| `event` | the event name for `addEventListener`                         |
| `id`    | the id the browser sends back as `Last-Event-ID` on reconnect |
| `retry` | how long the browser waits before reconnecting, in ms         |

A plain string is shorthand for `{ data }`. Names and ids with line breaks are refused, so data
cannot inject extra fields.

- **Backpressure.** The generator advances only when the client has read the previous event, so a
  slow client slows the generator instead of filling memory.
- **Disconnects.** When the client leaves, `signal` aborts and the generator's `finally` runs. Pass
  `signal` to anything the generator waits on, so it stops at once instead of on the next event.
- **Heartbeats.** A comment line every 15 seconds keeps proxies from closing a quiet connection.
  Change it with `sse(ctx, source, { heartbeat: 30_000 })`, or turn it off with `false`.
- The response sets `cache-control: no-cache` and `x-accel-buffering: no`, so proxies such as nginx
  pass events through immediately.

For two-way messages, WebSockets are planned as an experimental package.

## Request ids and logging

Every request gets an id, available as `ctx.id` and sent back in the `x-request-id` header. When the
client or a gateway already sent an `x-request-id` (up to 128 visible characters), that one is
reused, so one id follows a request through several services:

```ts
route({ method: 'GET', path: '/orders', handler: (ctx) => orders.list({ traceId: ctx.id }) });
```

```ts
createAvi({
  requestId: { header: 'x-trace-id' }, // another header
  // requestId: { trustIncoming: false }, // always generate, for untrusted clients
  // requestId: false,                    // no header at all
});
```

Errors Avi.js logs carry the id, so a `500` a user reports can be found in the logs. The logger
gets it as a third argument, `{ requestId, method, path }`. The default logger prints
`Request failed: GET /orders [3f2a…]`.

For log collectors, `jsonLogger()` writes one JSON object per line, and `logRequests()` logs every
response through it:

```ts
import { createAvi, jsonLogger, logRequests } from '@avijs/core';

const logger = jsonLogger(); // jsonLogger({ level: 'warn' }) to keep only warnings and errors
const app = createAvi({
  logger,
  onResponse: logRequests(logger, { skip: (info) => info.route === '/health' }),
});
```

```json
{
  "requestId": "3f2a…",
  "method": "GET",
  "path": "/orders",
  "route": "/orders",
  "status": 200,
  "duration": 2.41,
  "aborted": false,
  "time": "2026-10-23T08:00:00.000Z",
  "level": "info",
  "msg": "GET /orders 200"
}
```

`5xx` responses and aborted requests are logged as warnings. Any logger with an `error(message,
error, fields)` method works; `info` and `warn` are optional. For pino:

```ts
const app = createAvi({
  logger: {
    error: (message, error, fields) => pino.error({ ...fields, err: error }, message),
    warn: (message, fields) => pino.warn(fields, message),
    info: (message, fields) => pino.info(fields, message),
  },
});
```

## Startup summary

When the server is up, `listen()` reports what Avi.js checked on the way:

```text
AVI.JS 0.3.0 · Application bootstrap

✓ 3 modules loaded
✓ Dependency graph validated
✓ 2 providers resolved
✓ Config validated (1 variable)
✓ 4 routes registered
✓ HTTP server ready on http://localhost:3000

Startup completed in 5.3 ms
```

Every line is a check that ran: the module graph, every provider created, `defineConfig`
validated, every route registered. The time runs from `createAvi()` to the moment the server
accepts connections. If startup fails, the summary shows how far it got and the failing step,
with the error and its cause:

```text
✓ 2 modules loaded
✓ Dependency graph validated
✗ Providers: Failed to create Database in DatabaseModule
  connect ECONNREFUSED 127.0.0.1:5432

Startup failed after 1.1 ms
```

Where it goes depends on where the output goes:

| Situation                    | Output                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| A terminal                   | The block above, in color (plain with `NO_COLOR`)          |
| Logs, containers, CI         | One line: `Avi.js 0.3.0 started in 5.3 ms: 3 modules, ...` |
| A logger with `info`         | One structured entry, `Application started`, with counts   |
| `NODE_ENV=test`, test client | Nothing                                                    |

```ts
createAvi({ startupSummary: 'routes' }); // also list every route with its controller
createAvi({ startupSummary: false }); // nothing at all
```

It runs once, after startup, and costs about 25 microseconds; requests never touch it.

## A production entry point

```ts
import { createAvi, jsonLogger, logRequests } from '@avijs/core';

const logger = jsonLogger();
const log = logRequests(logger);

const app = createAvi({
  bodyLimit: 256 * 1024,
  shutdownTimeout: 15_000,
  headersTimeout: 10_000,
  requestTimeout: 30_000,
  logger,
  onResponse: (info) => {
    log(info);
    metrics.observe({ method: info.method, route: info.route, status: info.status }, info.duration);
  },
});

// app.register(...)

await app.listen(Number(process.env['PORT'] ?? 3000), '0.0.0.0');

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
```

- Set `shutdownTimeout` below your platform's kill grace period (Kubernetes defaults to 30 seconds)
  so in-flight requests finish before the process is killed.
- Behind a load balancer, set `keepAliveTimeout` above the balancer's idle timeout so it never
  reuses a connection Node has just closed.
- `requestTimeout`, `headersTimeout`, `keepAliveTimeout` and `connectionsCheckingInterval` are
  passed straight to `node:http`.

## Performance

The repository's `benchmarks/` folder measures routing, startup, HTTP throughput and validation
overhead, with the method and machine for every number. They are local measurements, not
comparisons with other frameworks; Avi.js makes no speed claims until those exist.

## Next

[Chapter 8: Testing your app](08-testing.md).
