# 8. Testing your app

> **Status: Runnable.** Everything on this page works today.

`@avijs/testing` starts your app on a random local port and gives you a small client for it. Tests
talk to the app over real HTTP, so they exercise routing, middleware, guards, validation and
serialization exactly as production does.

## A first test

This uses Node's built-in test runner on the compiled output, which is what `avi new` sets up. Any
runner works the same way.

```ts
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestClient, type TestClient } from '@avijs/testing';
import { AppModule } from '../app.module.js';

let client: TestClient;
before(async () => {
  client = await createTestClient(AppModule);
});
after(() => client.close());

test('creates a user', async () => {
  const res = await client.post('/users', { name: 'Grace' });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: 2, name: 'Grace' });
});
```

The client has `get`, `post`, `put`, `patch`, `delete` and a general `request(method, path, init)`:

| Option    | Meaning                                                 |
| --------- | ------------------------------------------------------- |
| `body`    | Objects are sent as JSON; strings and bytes as they are |
| `headers` | Request headers                                         |
| `query`   | `{ tag: ['a', 'b'] }` becomes `?tag=a&tag=b`            |

Each response has `status`, `headers`, `text`, and `body`: parsed JSON for JSON responses, the text
otherwise. `client.close()` stops the app and disposes its providers.

### Signed-in requests

`client.withHeaders(headers)` gives a client for the same app that sends those headers on every
request; headers passed to a call still win. One per user keeps tests short:

```ts
const shiela = client.withHeaders({ authorization: `Bearer ${await signIn('shiela')}` });
const grace = client.withHeaders({ authorization: `Bearer ${await signIn('grace')}` });

assert.equal((await shiela.post('/teams', { name: 'Launch' })).status, 201);
assert.equal((await grace.get('/teams/1')).status, 404); // not a member
```

It keeps the `Api` type of a [typed client](15-typed-client.md#typed-tests), so
`shiela.api.post(...)` works too. Close only the original client.

## Replacing providers

Pass `overrides` to swap a provider anywhere in the module graph, however deeply it is imported:

```ts
const sent: string[] = [];
client = await createTestClient(AppModule, {
  overrides: [{ provide: Mailer, useValue: { send: (to: string) => sent.push(to) } }],
});
```

An override that matches no provider is an error, so a renamed token cannot silently stop a test
from working. Overrides use the normal provider forms, so `useClass` and `useFactory` work too.

`createTestClient` also accepts any `createAvi` option, or an app you built yourself:

```ts
client = await createTestClient(createAvi({ middleware: [apiVersion] }).register(AppModule));
```

## Testing providers directly

For unit tests of a single service, skip HTTP:

```ts
const app = createAvi({ overrides: [{ provide: Db, useValue: fakeDb }] }).register(UsersModule);
await app.init();
const users = app.get(UsersService);
```

## With Vitest

Vitest's built-in transform does not compile standard decorators yet. If your app uses
decorators, add the small `tsc` plugin from [Chapter 4](04-controllers.md#tooling-setup), or run
your tests on the compiled output as above.

## Next

[Chapter 9: Project structure](09-project-structure.md).
