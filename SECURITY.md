# Security policy

## Supported versions

Avi.js is in 0.x. Security fixes go into the latest 0.x release only; upgrade to it to get them.
Once 1.0 is out, this table will list which lines are supported.

| Version    | Supported |
| ---------- | --------- |
| Latest 0.x | Yes       |
| Older 0.x  | No        |

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub security advisories](https://github.com/chrischase011/avi-js/security/advisories/new)
with the affected package, a description, and steps or code to reproduce it. You should get a
reply within a week. Once a fix is released, the advisory is published with credit to you unless
you ask otherwise.

Published advisories: [github.com/chrischase011/avi-js/security/advisories](https://github.com/chrischase011/avi-js/security/advisories).

## What Avi.js protects against by default

| Risk                        | Default                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Large request bodies        | 1 MiB limit (`bodyLimit`); oversized bodies get `413` and are never read past it                               |
| Slow or stalled clients     | `headersTimeout` and `requestTimeout` from `node:http` close them                                              |
| Malformed HTTP              | Node's strict parser rejects it (`400`, `431` for oversized headers)                                           |
| Malformed URLs              | Bad percent-encoding gets `400` before any handler runs                                                        |
| Leaking internals in errors | 5xx responses never include messages or stack traces, in any environment                                       |
| Errors served as HTML       | Error responses are always JSON; a handler's `content-*` and caching headers are not kept                      |
| Header injection            | `ctx.setHeader`, `reply()` and `HttpError` headers are validated by `node:http`                                |
| Large or reflected 400s     | Validation errors send at most 50 issues, with messages and paths cut to size                                  |
| Prototype pollution         | Route params, query objects and form fields have no prototype                                                  |
| Content sniffing            | Every response sets `x-content-type-options: nosniff`                                                          |
| Leaking fields in responses | Opt-in response schemas send only the fields they declare                                                      |
| Secrets in config errors    | `defineConfig` errors never contain the values, even after a transform                                         |
| Spoofed client addresses    | `X-Forwarded-For` is ignored unless `trustProxy` says how many proxies to trust                                |
| Upload abuse                | `@avijs/multipart` limits size, counts and parts by default; `accept` limits file types                        |
| Typed client requests       | `@avijs/client` encodes path params and refuses values that would change the route                             |
| Dependency supply chain     | One third-party runtime dependency (`@fastify/busboy`, in `@avijs/multipart`); a CI check fails on any new one |

`@avijs/security` adds security headers (CSP, HSTS, frame and referrer policies), CORS and rate
limiting as `onRequest` hooks. They are opt-in: add them in `createAvi({ onRequest: [...] })`.

## What is up to you

- **Request bodies are untrusted.** `ctx.json()` returns whatever the client sent, including keys
  such as `__proto__`. Validate it with a route schema before merging it into other objects.
- **Catch-all parameters** (`/files/*`) pass `..` through on the server. Never join them onto a file
  system path without checking the result.
- **Authentication and authorization** are yours: write them as guards.
- **`trustProxy`** must match the real number of proxies in front of the app; a higher number lets
  clients choose their own `ctx.ip`, and with it their rate limit.
- **CORS matchers**: a function or regular expression that matches too much, with
  `credentials: true`, lets other sites act as your users. Anchor expressions or list origins.
- **Logs**: the default console logger prints whole error objects; use `jsonLogger()` or your own
  logger in production. Paths are logged, so keep tokens out of URLs.
- **`avi-compile manifest` imports your entry module**, which runs its top-level code. Only run it
  on code you trust, as with any build step.
- Never enable Node's `insecureHTTPParser`.

The full threat model and the review checklist are in [security/](security/README.md).
