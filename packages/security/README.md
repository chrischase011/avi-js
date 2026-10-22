# @avijs/security

CORS and security headers for Avi.js, as `onRequest` hooks.

```sh
npm install @avijs/security
```

```ts
import { createAvi } from '@avijs/core';
import { cors, securityHeaders } from '@avijs/security';

const app = createAvi({
  onRequest: [securityHeaders(), cors({ origin: 'https://app.example.com' })],
});
```

Part of [Avi.js](https://github.com/chrischase011/avi-js), a TypeScript framework for Node.js with
modules, controllers and dependency injection, without `reflect-metadata`. See the
[security chapter](https://github.com/chrischase011/avi-js/blob/main/docs/tutorial/12-security.md)
of the tutorial.

Requires Node.js 22.12 or newer. MIT licensed.
