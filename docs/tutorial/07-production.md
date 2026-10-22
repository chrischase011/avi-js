# 7. Running in production

> **Status: Planned (Phases 1, 7 and 10).** This page describes the agreed behavior only.

These defaults are part of Avi.js from the start, not add-ons:

| Concern            | Default behavior                                                                 |
| ------------------ | -------------------------------------------------------------------------------- |
| Request bodies     | Size-limited. Oversized bodies are rejected before being fully read.             |
| Error responses    | Generic messages. No stack traces or internal details sent to clients.           |
| Malformed input    | Bad URL encodings and invalid requests are rejected safely.                      |
| Client disconnects | Detected. Handlers get an `AbortSignal` to stop work early.                      |
| Streaming          | Supported, with backpressure respected.                                          |
| Shutdown           | `app.close()` drains in-flight requests and disposes providers in reverse order. |

## Performance

Avi.js aims for low overhead and will publish benchmarks against `node:http`, Fastify, Hono and
NestJS, with the full methodology. Until those exist, this project makes no speed claims.

## Next

[Chapter 8: Testing your app](08-testing.md).
