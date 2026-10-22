# 8. Testing your app

> **Status: Partly runnable.** Testing over HTTP works today. Dedicated testing helpers are
> planned for Phase 9.

## Today: a real server on a random port

Each `createAvi()` app is self-contained, so every test can start its own on port `0` and talk to
it with `fetch`:

```ts
import { afterEach, expect, it } from 'vitest';
import { createAvi, defineController, type AviApp } from '@avi/core';

let app: AviApp;

afterEach(() => app.close());

it('says hello', async () => {
  app = createAvi().register({
    controllers: [
      defineController({
        routes: [{ method: 'GET', path: '/', handler: () => ({ message: 'Hello, Avi' }) }],
      }),
    ],
  });
  const { port } = await app.listen(0, '127.0.0.1');

  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ message: 'Hello, Avi' });
});
```

`close()` also closes the keep-alive connections `fetch` leaves open, so tests do not hang.

The workspace's own tests in `packages/*/test` use the same approach.

## Planned

- Testing helpers that send requests to an app without opening a port.
- Replacing any provider with a test double by registering a different provider for the same
  token (once DI lands in Phase 3).

## Next

[Chapter 9: Project structure](09-project-structure.md).
