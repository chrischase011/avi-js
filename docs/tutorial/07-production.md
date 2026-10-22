# 7. Running in production

> **Status: Partly runnable.** Rows marked _Available_ work today. The rest are planned for
> Phases 7 and 10.

These defaults are part of Avi.js from the start, not add-ons:

| Concern            | Default behavior                                                                | Status    |
| ------------------ | ------------------------------------------------------------------------------- | --------- |
| Request bodies     | Limited to 1 MiB (`bodyLimit`). Oversized bodies get `413`, never read past it. | Available |
| Error responses    | Generic 5xx bodies in every environment. Details go to your logger.             | Available |
| Client disconnects | `ctx.signal` aborts so handlers can stop work early.                            | Available |
| Shutdown           | `app.close()` drains in-flight requests, then forces after `shutdownTimeout`.   | Available |
| Timeouts           | `requestTimeout` and `headersTimeout` are passed to `node:http`.                | Available |
| Malformed paths    | Bad URL encodings are rejected with `400`.                                      | Available |
| Provider cleanup   | Providers are disposed in reverse dependency order on `close()`.                | Available |
| Streaming          | Streamed responses with backpressure.                                           | Phase 7   |

## A production entry point

```ts
import { createAvi } from '@avi/core';

const app = createAvi({
  bodyLimit: 256 * 1024,
  shutdownTimeout: 15_000,
  logger: { error: (message, error) => console.error(message, error) },
});

// app.register(...)

await app.listen(Number(process.env['PORT'] ?? 3000), '0.0.0.0');

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
```

Set `shutdownTimeout` below your platform's kill grace period (Kubernetes defaults to 30 seconds)
so in-flight requests finish before the process is killed.

## Performance

Avi.js aims for low overhead and will publish benchmarks against `node:http`, Fastify, Hono and
NestJS, with the full methodology. Until those exist, this project makes no speed claims.

## Next

[Chapter 8: Testing your app](08-testing.md).
