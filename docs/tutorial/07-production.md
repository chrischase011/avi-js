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

## A production entry point

```ts
import { createAvi } from '@avijs/core';

const app = createAvi({
  bodyLimit: 256 * 1024,
  shutdownTimeout: 15_000,
  headersTimeout: 10_000,
  requestTimeout: 30_000,
  logger: { error: (message, error) => console.error(message, error) },
  onResponse: ({ method, route, status, duration }) => {
    metrics.observe({ method, route, status }, duration);
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
