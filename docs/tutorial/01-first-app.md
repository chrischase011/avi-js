# 1. Your first app

> **Status: Planned (Phase 1).** This chapter shows the target API. The code does not run yet.

## Hello, Avi

```ts
// src/main.ts
import { createAvi, defineController } from '@avi/core';

const hello = defineController({
  prefix: '/',
  routes: [
    { method: 'GET', path: '/', handler: () => ({ message: 'Hello, Avi' }) },
    { method: 'GET', path: '/health', handler: () => 'ok' },
  ],
});

const app = createAvi();
app.register({ controllers: [hello] });

await app.listen(3000);
```

```sh
curl localhost:3000/
# {"message":"Hello, Avi"}

curl localhost:3000/health
# ok
```

## What the handler returns decides the response

| Handler returns    | Response                                 |
| ------------------ | ---------------------------------------- |
| An object or array | `200`, `application/json`                |
| A string           | `200`, `text/plain; charset=utf-8`       |
| A promise          | Awaited, then handled by the rules above |
| Throws or rejects  | A safe error response (see below)        |

Handlers can be `async`. There is no `res.send()`: you return a value.

## Errors are safe by default

```ts
{
  method: 'GET',
  path: '/boom',
  handler: () => {
    throw new Error('database password is hunter2');
  },
}
```

The client gets a generic `500` body. The original message and stack trace go to your logs, not
to the client.

## Shutting down

```ts
process.on('SIGTERM', () => {
  void app.close();
});
```

`close()` stops accepting connections, lets in-flight requests finish, then resolves.

## Next

[Chapter 2: Routing](02-routing.md).
