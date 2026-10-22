# 12. Security headers and CORS

> **Status: Runnable.** Everything on this page works today.

`@avijs/security` adds two things most APIs need: security headers and CORS. Both are `onRequest`
hooks, which run for every request before routing, including 404s and `OPTIONS` preflights.

```sh
npm install @avijs/security
```

```ts
import { createAvi } from '@avijs/core';
import { cors, securityHeaders } from '@avijs/security';

const app = createAvi({
  onRequest: [securityHeaders(), cors({ origin: 'https://app.example.com', credentials: true })],
});
```

## Security headers

`securityHeaders()` sends these by default:

| Header                         | Default                                      |
| ------------------------------ | -------------------------------------------- |
| `Content-Security-Policy`      | `default-src 'none'; frame-ancestors 'none'` |
| `Strict-Transport-Security`    | `max-age=31536000; includeSubDomains`        |
| `X-Frame-Options`              | `DENY`                                       |
| `Referrer-Policy`              | `no-referrer`                                |
| `Cross-Origin-Resource-Policy` | `same-origin`                                |

Avi.js always sends `X-Content-Type-Options: nosniff`, with or without this hook.

The defaults suit a JSON API. Change a value or pass `false` to leave a header out:

```ts
securityHeaders({
  contentSecurityPolicy: "default-src 'self'",
  crossOriginResourcePolicy: 'cross-origin',
  strictTransportSecurity: false,
});
```

A route can still set its own value with `reply()`, which wins over the hook:

```ts
handler: () => reply(html, { headers: { 'content-security-policy': "default-src 'self'" } });
```

## CORS

Browsers block a page on one origin from reading responses from another, unless the server allows
it. `cors()` does that for the origins you list.

```ts
cors({ origin: 'https://app.example.com' });
cors({ origin: ['https://app.example.com', 'https://admin.example.com'] });
cors({ origin: /^https:\/\/[a-z]+\.example\.com$/ });
cors({ origin: (origin) => allowedOrigins.has(origin) });
cors({ origin: '*' }); // any origin, without credentials
```

| Option           | Default                               | Meaning                                 |
| ---------------- | ------------------------------------- | --------------------------------------- |
| `origin`         | required                              | Which origins may call the API          |
| `methods`        | `GET, HEAD, PUT, PATCH, POST, DELETE` | Methods allowed in preflights           |
| `allowedHeaders` | the headers the browser asks for      | Request headers allowed in preflights   |
| `exposedHeaders` | none                                  | Response headers the page may read      |
| `credentials`    | `false`                               | Allow cookies and `Authorization`       |
| `maxAge`         | not sent                              | Seconds a browser may cache a preflight |

What happens per request:

- **Allowed origin, preflight** (`OPTIONS` with `Access-Control-Request-Method`): `204` with the
  allow headers. Your routes don't run.
- **Allowed origin, any other request**: the route runs as usual, and the response gets
  `Access-Control-Allow-Origin` (and the credentials and exposed headers, if set). Error responses
  get them too, so the page can read the error.
- **Other origins**: no CORS headers, so the browser blocks the response. The request itself is
  not rejected; CORS protects browser users, not your server. Use guards for access control.

### Mistakes it catches at startup

- `origin: '*'` with `credentials: true` throws. Browsers refuse that combination, and echoing any
  origin with credentials would let every site act as your users.
- An origin with a path or trailing slash, like `'https://app.example.com/'`, throws. Browsers send
  origins without one, so it would never match.

## Writing your own hook

A hook gets the request context. Return `undefined` to continue, or a value to answer right away:

```ts
import { HttpError, type RequestHook } from '@avijs/core';

const maintenance: RequestHook = () => {
  if (process.env.MAINTENANCE === '1') throw new HttpError(503, 'Back soon');
};

const app = createAvi({ onRequest: [maintenance] });
```

Hooks run in order, before routing. They can't use dependency injection; for per-route logic with
providers, use middleware and guards ([Chapter 5](05-request-pipeline.md)).

## Next

[Chapter 13: Avi.js for NestJS developers](13-from-nestjs.md).
