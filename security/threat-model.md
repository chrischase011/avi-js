# Threat model

What Avi.js defends against, what it leaves to the application, and where the line between them
runs. Written for the security review before 1.0; it describes the code at the version in the
repository's `package.json` files.

## What Avi.js is

A library that runs inside the application's Node.js process: an HTTP server on `node:http`, a
router, dependency injection, validation through Standard Schema libraries, and optional
packages for security headers, CORS, rate limits, uploads, OpenAPI, a typed `fetch` client and
workers. It has no network service of its own, stores nothing, and has one third-party runtime
dependency (`@fastify/busboy`, in `@avijs/multipart`).

The application's own code (handlers, providers, guards, schemas) is trusted. Everything that
arrives over the network is not.

## Trust boundaries

| Boundary                   | Untrusted input                                                                      | Handled by Avi.js                                                                                                                          | Left to the application                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Network → server           | Request line, headers, body, timing                                                  | Node's strict parser; body limit (1 MiB) read on demand; timeouts; URL decoding errors → 400; 404/405/HEAD/OPTIONS                         | Authentication and authorization (guards), business rules                                 |
| Request data → handlers    | Path params, query, JSON bodies, form fields, uploaded files                         | Null-prototype params and query; route schemas validate and strip; upload limits and `accept`; errors as 4xx JSON                          | Validating anything without a schema; never using file names or catch-all params as paths |
| Handlers → responses       | Values the handler returns, possibly derived from user data                          | JSON/text serialization; errors always JSON; `nosniff` on every response; response schemas drop undeclared fields; header values validated | What data a route exposes; HTML escaping if it sends HTML                                 |
| Errors → client and logs   | Exceptions with internal details                                                     | 5xx bodies never include messages or stacks; 4xx `details` only when set; config errors redact values                                      | Not putting secrets in 4xx messages or `details`                                          |
| Proxy → server             | `X-Forwarded-For`, `X-Request-Id`                                                    | Both ignored unless configured (`trustProxy` hop count, `requestId.trust`); incoming ids validated                                         | Setting `trustProxy` to the real number of proxies                                        |
| Browser → server (CORS)    | `Origin`, preflight requests                                                         | `cors()` answers only listed origins; refuses `'*'` with credentials; `Vary: Origin`                                                       | Listing origins; CSRF protection for cookie-based auth                                    |
| Clients → limits           | Request volume                                                                       | `rateLimit()` with a bounded in-memory store and `Retry-After`                                                                             | A shared store across processes; limits at the proxy or CDN for floods                    |
| Environment → app          | `process.env`, `.env` files                                                          | `defineConfig` validates with a schema and never puts values in errors                                                                     | Keeping secrets out of logs and responses                                                 |
| App → other APIs (client)  | Values passed as params, query or body to `@avijs/client`                            | Params percent-encoded; `.`, `..` and empty values refused; `baseUrl` without query; query and JSON encoded                                | Choosing `baseUrl`; what it sends where                                                   |
| Developer → generated code | Project names, resource names, route paths (`avi new`, `avi generate`, `avi client`) | Names validated; files written only inside the project; existing files not overwritten                                                     | Reviewing generated code like any other code                                              |
| Primary ↔ workers          | IPC messages between processes of the same app                                       | Only processes the primary forked exchange messages; graceful shutdown waits for routing to stop                                           | OS-level isolation of the machine                                                         |

## Out of scope

- **Denial of service by volume.** A single Node.js process can be flooded; Avi.js bounds what one
  request can cost (body, headers, upload sizes, timeouts) but leaves volumetric attacks to the
  proxy, load balancer or CDN in front.
- **The application's own logic**: authorization decisions, SQL or other injection in its own
  queries, what it logs, how it stores secrets.
- **The host**: Node.js itself, the operating system, TLS termination (Avi.js speaks plain HTTP;
  TLS is expected at a proxy or via `node:https` options passed by the application).
- **Development tools run on trusted code**: `avi-compile manifest` imports the app's entry module,
  and `avi dev` runs it; both execute the developer's own code by design.
- **Unsafe Node.js options** such as `insecureHTTPParser`.

## Assumptions

- Avi.js runs behind a reverse proxy or load balancer in production, or directly with the Node.js
  timeouts it sets.
- `trustProxy` matches the real number of proxies in front of the app. Setting it higher lets
  clients choose their own `ctx.ip`.
- Applications validate input with route schemas where it matters. Without a schema,
  `ctx.json()` returns whatever the client sent.
