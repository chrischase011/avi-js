# Security policy

## Supported versions

Avi.js has not had a release yet. Until 1.0, security fixes land on `main` and in the next
release only.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub security advisories](https://github.com/chrischase011/avi-js/security/advisories/new)
with the affected package, a description, and steps or code to reproduce it. You should get a
reply within a week. Once a fix is released, the advisory is published with credit to you unless
you ask otherwise.

## What Avi.js protects against by default

| Risk                        | Default                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| Large request bodies        | 1 MiB limit (`bodyLimit`); oversized bodies get `413` and are never read past it |
| Slow or stalled clients     | `headersTimeout` and `requestTimeout` from `node:http` close them                |
| Malformed HTTP              | Node's strict parser rejects it (`400`, `431` for oversized headers)             |
| Malformed URLs              | Bad percent-encoding gets `400` before any handler runs                          |
| Leaking internals in errors | 5xx responses never include messages or stack traces, in any environment         |
| Header injection            | `ctx.setHeader` and `reply()` headers are validated by `node:http`               |
| Prototype pollution         | Route params and query objects have no prototype                                 |
| Content sniffing            | Every response sets `x-content-type-options: nosniff`                            |
| Leaking fields in responses | Opt-in response schemas send only the fields they declare                        |
| Dependency supply chain     | No third-party runtime dependencies                                              |

## What is up to you

- **Request bodies are untrusted.** `ctx.json()` returns whatever the client sent, including keys
  such as `__proto__`. Validate it with a route schema before merging it into other objects.
- **Catch-all parameters** (`/files/*`) pass `..` through. Never join them onto a file system path
  without checking the result.
- **CORS, rate limiting, security headers and authentication** are not built in. Add them as
  middleware or guards.
- **`avi-compile manifest` imports your entry module**, which runs its top-level code. Only run it
  on code you trust, as with any build step.
- Never enable Node's `insecureHTTPParser`.
