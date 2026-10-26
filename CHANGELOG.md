# Changelog

All notable changes are listed here. Avi.js follows [Semantic Versioning](https://semver.org); all
packages share one version.

## 0.5.1 - 2026-10-26

### Fixed

- **Security:** `@avijs/client` and the typed test client refuse a path parameter of `.` or `..`
  (or a wildcard containing such a segment) with a `TypeError`. URLs resolve these segments, even
  percent-encoded, so `api.get('/users/:id/posts', { params: { id: '..' } })` used to request
  `/posts`: a value from user input could reach a different route with the same credentials.
- `@avijs/workers`: a rolling restart or shutdown could leave a request hanging. On Linux and
  macOS the primary hands connections to workers, and one handed over just as a worker closed was
  lost when it exited. Workers now tell the primary they have closed and wait until it stops
  routing to them. The tests force this handoff mode on every OS.

## 0.5.0 - 2026-10-26

### Added

- **`@avijs/workers`**, a new package:
  - `cluster(start, { workers })` runs the app in one worker process per CPU core on one port. The
    primary only manages workers: it replaces crashed ones, stops after a crash loop, closes
    workers gracefully on `SIGINT`/`SIGTERM`, and restarts them one at a time on `SIGHUP` or
    `handle.restart()`. With one worker or `NODE_ENV=development` it runs in the same process.
  - `runWorker(AppModule, (app, signal) => ...)` runs background work with the app's providers
    and no HTTP server: `signal` aborts on shutdown, providers close afterwards, and the exit code
    says whether startup or the work failed.
- Docs: chapter 16, Workers and multiple cores. Example: `workers-api`, a clustered API with a
  background worker.

### Changed

- The startup summary stays quiet in cluster workers other than the first, so a cluster prints one
  block instead of one per worker.

## 0.4.0 - 2026-10-23

### Added

- `@avijs/multipart`: an `accept` option for `multipart()` and `readForm()` lists the file types a
  form may contain, exactly (`application/pdf`) or by family (`image/*`). A file of another type
  gets `415` before it is read.
- Benchmarks you can trust on a noisy machine: servers run in interleaved rounds in random order
  with `node:http` as a canary, report the median, range and server CPU time per request, and
  check that every server answers alike first. New cases: a 50-item list and an authenticated
  `POST`. `bench:inproc` runs Avi's whole request path in one process, `bench:profile` shows where
  the time goes, and `bench:baseline` saves a build to compare a change against.

### Changed

- Reading a JSON body skips a copy and an extra step: about 0.2 µs less per request, measured on
  the operations themselves (too small to show in an HTTP benchmark).

## 0.3.0 - 2026-10-23

### Added

- **Typed client.** `avi client` reads an app's modules and controllers and writes `src/api.gen.ts`,
  an `Api` type that references the app's own controllers, for both decorators and the explicit
  API. `--check` fails in CI when it is out of date; routes it cannot follow get a warning with a
  fix (AVI101 to AVI106).
- **`@avijs/client`**: `createClient<Api>({ baseUrl })` calls routes by path with typed params,
  query, body and response; non-2xx throws `AviClientError` with the status, error body and
  request id; `api.raw` returns the `Response`. No dependencies; runs anywhere `fetch` does.
- `createTestClient<Api>(...)` adds `client.api` with the same typed calls, returning
  `{ ok, status, headers, body }` without throwing. Test responses gain `ok`.
- Types for typed clients in `@avijs/core`: `MethodEndpoint`, `RouteEndpoint`, `Endpoint`,
  `Jsonify`, `ResponseBody`, `RouteOf`.
- Generated projects include `src/api.gen.ts`, a `client` script and a typed test.
- Docs: chapter 15, Typed client. "Avi.js for NestJS developers" moves to the end as an appendix,
  so Configuration and File uploads are now chapters 13 and 14.
- A startup summary from `listen()`: modules, providers, config and routes checked, the address
  and the startup time; on failure, how far startup got, the failing step and its cause. A block in a
  terminal, one line in logs, a structured entry for loggers with `info`, nothing under
  `NODE_ENV=test`. `startupSummary: 'routes'` lists every route; `false` turns it off.

### Changed

- Generated projects and the examples no longer print their own `Listening on` line.
- `createTestClient` turns the startup summary off.
- Type-only, for typed clients: `reply()` returns `Reply<T>`; `sse()` returns
  `Reply<ReadableStream<Uint8Array>>`; `route()` returns `RouteOf<S, R>`; `defineController`
  returns `ControllerDefinition<Routes>`; `RouteContext` carries its schema type. Runtime behavior
  is unchanged.

## 0.2.1 - 2026-10-23

### Fixed

- `@avijs/multipart`: some malformed bodies left the request hanging until the server timeout, and
  a file part that broke off mid-upload answered `500`. Both now answer `400`. Found by fuzzing.

## 0.2.0 - 2026-10-23

### Added

- `RouteContext<typeof schema>` types a decorator handler from its route schema object, instead of
  `Context<InputOf<{ body: typeof X }>>`. Generated code and the examples use it.
- `sse(ctx, generator)` streams server-sent events with backpressure, heartbeats and an abort
  signal for client disconnects.
- Request ids: `ctx.id`, sent back as `x-request-id` (an incoming one is reused), passed to
  `onResponse` and to error logs. Configure or turn off with `requestId`.
- `jsonLogger()` writes JSON lines; `logRequests(logger)` logs every response. `Logger` gains
  optional `warn` and `info`, and `error` receives `{ requestId, method, path }`.
- `defineConfig(schema)`: typed config from environment variables and an optional `.env` file,
  validated at startup with every problem listed and values redacted. Inject it with
  `Config.module`; `avi check` understands config tokens. New projects get a `src/config.ts`.
- `rateLimit({ limit, window })` in `@avijs/security`: `429` with `Retry-After` and `RateLimit-*`
  headers, per-route limits through `.guard`, a capped in-memory store and a pluggable store.
- `ctx.ip`, with a `trustProxy` option for apps behind proxies (`X-Forwarded-For` is ignored by
  default).
- `@avijs/multipart`: `multipart(ctx)` streams uploads part by part and `readForm(ctx)` buffers
  small forms, with size and count limits on by default (`413`), built on `@fastify/busboy`.
- `avi new --validator valibot|zod|none` (default `valibot`): the templates validate the users
  routes with route schemas, including response schemas. `npm create avi` asks for it.
- `avi g resource` generates schemas with the project's Valibot or Zod (or `--validator`): request
  bodies drop unknown fields, and updates need at least one field.

### Changed

- `generateOpenApi` names the route and schema when a JSON Schema converter fails.
- Generating a resource without a validation library prints a note that request bodies are stored
  as sent.

## 0.1.2 - 2026-10-22

### Added

- `avi generate resource` (`avi g res`) creates a module, service and controller with CRUD routes
  in one step, or a service and routes in minimal projects.

### Changed

- Each package's npm `homepage` now points to the website.

## 0.1.1 - 2026-10-22

### Added

- `avi generate` (`avi g`) creates a module, controller or service and registers it in the nearest
  module, or in `src/app.ts` for minimal projects.

### Fixed

- `avi check` no longer reports a mismatch for generic classes used as tokens, such as Prisma's
  `PrismaClient`.

## 0.1.0 - 2026-10-22

The first release. Everything below is new.

### Core and HTTP

- `createAvi`, `AviFactory`, `register`, `init`, `listen`, `close` with graceful shutdown.
- Return-value responses: JSON, text, bytes, `204`, `reply()` for status and headers, streams
  (Node `Readable`, web `ReadableStream`) and web `Response`, with backpressure.
- Safe errors: `HttpError` with `headers` and `details`; 5xx details never sent.
- Request bodies read on demand with a size limit; `ctx.text()`, `ctx.json()`.
- `onRequest` hooks that run before routing, for every request including 404s and `OPTIONS`.
- Segment-trie router: `:params`, trailing `*`, deterministic precedence with backtracking, `405`
  with `Allow`, automatic `HEAD` and `OPTIONS`, a direct lookup for static routes.

### Modules and dependency injection

- `defineModule` / `@Module` with imports, exports, re-exports and prefixes.
- Class, value and factory providers; singleton and transient scopes; async factories; reverse-order
  disposal. Explicit `static inject`, no `reflect-metadata`.
- Request scope: `scope: 'request'` and the `REQUEST` token. Controllers that depend on a
  request-scoped provider are created per request; request instances are disposed afterwards.
- Startup checks with full dependency chains: missing or hidden providers, cycles, duplicates.
- `overrides` to replace providers in tests.

### Controllers and pipeline

- Explicit (`defineController`, `route()`) and decorator (`@Controller`, `@Get`, ...) APIs on one
  engine, proven equivalent by tests.
- Middleware and guards at app, module, controller and route level, as functions or classes with
  dependencies; `ctx.state`, `ctx.setHeader`, `errorHandler`, `onResponse`.

### Validation and typing

- Route schemas with any Standard Schema library; typed `ctx.input` and path params; response
  schemas that drop undeclared fields.

### Security

- `@avijs/security`: `cors()` and `securityHeaders()` as `onRequest` hooks.

### Tooling

- `@avijs/compiler`: `avi-compile check` for `static inject` lists and `manifest` for app manifests;
  `createAvi({ manifest })` refuses to start on a stale one.
- `@avijs/testing`: a test client.
- `@avijs/openapi`: OpenAPI 3.1 documents from routes and schemas.
- `@avijs/cli`: `avi new` (modular and minimal templates), `avi dev`, `avi check`, `avi manifest`.
- `create-avi`: `npm create avi@latest my-app`, asking for the name and template when missing.
