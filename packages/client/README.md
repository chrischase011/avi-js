# @avijs/client

A typed `fetch` client for Avi.js APIs. No dependencies; runs in browsers, Node.js, Bun, Deno and
workers.

```sh
npm install @avijs/client
```

Generate the `Api` type from your server with `avi client`, then:

```ts
import { createClient } from '@avijs/client';
import type { Api } from './api.gen.js';

const api = createClient<Api>({ baseUrl: 'http://localhost:3000' });

const user = await api.get('/users/:id', { params: { id: 1 } }); // typed response
await api.post('/users', { body: { name: 'Shiela' } }); // body checked against the schema
```

A status outside 2xx throws an `AviClientError` with `status`, the error `body` and the server's
`requestId`. `api.raw.get(...)` returns the `Response` instead.

Part of [Avi.js](https://github.com/chrischase011/avi-js). See the
[typed client chapter](https://chrischase011.github.io/avi-js/tutorial/15-typed-client) of the
tutorial. MIT licensed.
