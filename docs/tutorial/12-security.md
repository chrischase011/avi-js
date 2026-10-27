# 12. Security headers, CORS and rate limits

> **Status: Runnable.** Everything on this page works today.

`@avijs/security` adds three things most APIs need: security headers, CORS and rate limits. All are
`onRequest` hooks, which run for every request before routing, including 404s and `OPTIONS`
preflights.

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

In a project from `npm create avi`, pass the same options to `AviFactory.create` in `src/main.ts`:
`await AviFactory.create(AppModule, { onRequest: [...] })`. It initializes the app, so
`app.get(Config)` keeps working there.

### Settings from the config

Hooks are created before your providers, so a setting from your [config](13-configuration.md)
needs `defineHook` (from 0.7.0). It runs `create` once at startup with `inject` resolved and typed,
and the config is loaded only once, through dependency injection:

```ts
import { AviFactory, defineHook } from '@avijs/core';

const app = await AviFactory.create(AppModule, {
  onRequest: [
    securityHeaders(),
    defineHook({
      inject: [Config],
      create: (config) => cors({ origin: config.WEB_ORIGIN, credentials: true }),
    }),
  ],
});
await app.listen(app.get(Config).PORT);
```

The tokens must be visible from the modules you register, as for app-wide middleware; a missing one
stops startup with the usual error.

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

What it cannot catch: a function or regular expression that matches too much. With
`credentials: true`, `origin: /example\.com/` also allows `https://example.com.attacker.net`.
Anchor expressions (`/^https:\/\/([a-z]+\.)?example\.com$/`) or list the origins.

## Rate limiting

`rateLimit()` caps how many requests each client may send per time window:

```ts
import { rateLimit } from '@avijs/security';

const app = createAvi({
  onRequest: [rateLimit({ limit: 100, window: 60_000 })], // 100 requests per minute per client
});
```

Over the limit, the client gets `429 Too Many Requests` with a `Retry-After` header. Every response
also carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds), so
well-behaved clients can slow down before they hit the limit.

The count uses **fixed windows**: a client's window starts with its first request, and the count
starts over when the window ends. That is cheap and easy to share through a store, but a client
can send `limit` requests at the end of one window and `limit` more at the start of the next: up to
twice the limit in a short burst. Pick `limit` with that in mind, or keep windows short for strict
cases such as logins.

For a stricter limit on one route, such as a login, create a separate limiter and use its `guard`.
It keeps its own count:

```ts
const login = rateLimit({ limit: 5, window: 15 * 60_000 });

route({ method: 'POST', path: '/login', guards: [login.guard], handler: signIn });
```

| Option         | Default           | Meaning                                                          |
| -------------- | ----------------- | ---------------------------------------------------------------- |
| `limit`        | required          | Requests allowed per window                                      |
| `window`       | required          | Window length in ms                                              |
| `key`          | `(ctx) => ctx.ip` | What to count by, such as an API key or a user id                |
| `store`        | a memory store    | Where counts live; see below                                     |
| `onStoreError` | `'allow'`         | If the store fails: let requests through, or `'deny'` with `503` |
| `logger`       | `console.error`   | Receives store failures                                          |

The built-in store keeps counts in memory, for this process only. It tracks at most 100 000 keys
and drops the least recently used one when full, so a flood of new addresses cannot use up memory. When
several processes or servers share the load, give them a shared store. A store is one function:

```ts
import type { RateLimitStore } from '@avijs/security';

// A sketch for Redis 7+ with ioredis: count in a key that expires with the window.
const redisStore = (redis: Redis): RateLimitStore => ({
  async increment(key, window) {
    const [[, count], [, ttl]] = (await redis
      .multi()
      .incr(`rl:${key}`)
      .pexpire(`rl:${key}`, window, 'NX')
      .pttl(`rl:${key}`)
      .exec()) as [[null, number], [null, number], [null, number]];
    return { count, resetAt: Date.now() + ttl };
  },
});
```

## The client's IP address

`ctx.ip` is the address the request came from. Rate limits count by it unless you pass a `key`.

Behind a load balancer or reverse proxy, every request comes from the proxy's address. The proxy
passes the real client in `X-Forwarded-For`, but any client can send that header too, so Avi.js
ignores it until you say how many proxies you trust:

```ts
createAvi({ trustProxy: 1 }); // one proxy in front of the app, such as a load balancer
```

With `trustProxy: 1`, `ctx.ip` is the address your proxy saw. Set it to the number of proxies you
actually run, and no higher: one too many lets clients choose their own address, and with it their
own rate limit. A port the proxy adds (`1.2.3.4:5555`) is dropped, and an entry that is not an IP
address falls back to the socket address.

Two limits of counting by address:

- An IPv6 client usually controls a whole `/64` block and can rotate addresses within it. Where
  that matters, pass a `key` that counts by prefix, or limit at your proxy.
- The memory store keeps the 100 000 most recently used keys. A key that is still being used stays,
  but with a `key` the client chooses (an API key header, say), a flood of new keys can push out
  idle ones. Count by something the client cannot invent, or use a shared store with expiry.

## Writing your own hook

A hook gets the request context. Return `undefined` to continue, or a value to answer right away:

```ts
import { HttpError, type RequestHook } from '@avijs/core';

const maintenance: RequestHook = () => {
  if (process.env.MAINTENANCE === '1') throw new HttpError(503, 'Back soon');
};

const app = createAvi({ onRequest: [maintenance] });
```

Hooks run in order, before routing. A hook that needs providers comes from `defineHook`
([above](#settings-from-the-config)); for per-route logic, use middleware and guards
([Chapter 5](05-request-pipeline.md)).

## Next

[Chapter 13: Configuration](13-configuration.md).
