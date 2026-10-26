# Changelog

All notable changes are listed here. Avi.js follows [Semantic Versioning](https://semver.org); all
packages share one version.

## 0.7.0 - 2026-10-26

### Added

- `ctx.need(key)`: a `ctx.state` value a guard or middleware set, typed without `undefined`. When it
  is missing, because the route lacks the guard, it throws: a 500, with the reason in the log.
- `OpenApiModule.forRoot({ info, ... })` in the openapi package serves the app's document at
  `/openapi.json` (or `path`), built on the first request. Serving it took a placeholder variable,
  a manual `init()` and no `AviFactory.create`.
- `APP`: an injection token for the app itself, visible in every module.
- `defineHook({ inject, create })`: an `onRequest` hook built from providers at startup, so CORS or
  security settings can come from the config without loading it a second time by hand.
- multipart: file parts have `size`, the bytes received, complete once the stream has ended.
- client: `ResponseOf`, `BodyOf`, `QueryOf` and `ParamsOf` name an endpoint's types by its `Api`
  key, such as `ResponseOf<Api, 'GET /teams'>`.
- `avi new` ends with how to put the project in git.

### Changed

- multipart: limit and type errors quote the field name: `File "file" has type text/html`.

### Docs

- Chapter 14's streaming example removes a partially written file when the upload stops.
- The Prisma example reads its settings with `defineConfig` and builds `PrismaClient` with
  `defineFactory`.

## 0.6.0 - 2026-10-26

### Added

- `avi dev` keeps `src/api.gen.ts` in step with the routes: add, change or remove a route, save,
  and the file is updated before the app restarts, so a frontend's types follow without running
  `avi client`. It writes the file only when routes changed. `--client <file>` picks another file,
  `--no-client` turns it off; projects without `src/api.gen.ts` are not affected.
- `avi client --watch` does the same without compiling, for projects that build another way.
- `defineFactory({ provide, inject, useFactory })`: a factory provider typed from its `inject`
  list. In a plain `providers` array the parameters were unchecked, so tokens in the wrong order
  compiled and failed at startup. Chapter 3 and chapter 13 (config in a factory) show it.
- New projects' `src/config.ts` also exports `type Config`, the validated values, so constructors
  take `config: Config` instead of `TokenType<typeof Config>`.
- `@avijs/client`: `api.events(path, options)` reads a server-sent event stream as an async
  iterable, over `fetch`, so the client's headers (a token) are sent, which `EventSource` cannot
  do. Breaking the loop cancels the stream; aborting `signal` ends it quietly.
- `avi build`: see below.
- `@avijs/testing`: `client.withHeaders(headers)`, a client for the same app that sends those
  headers on every request, such as a signed-in user's token. Typed calls keep their `Api`.
- `@avijs/compiler`: `watchProject()` and `buildProject()`, behind `avi dev`, `avi client --watch`
  and `avi build`.

### Changed

- `@avijs/client`: where a query schema takes any string, the client also takes numbers and
  booleans (`query: { limit: 100 }`), since query values are sent as text. Literal values such as
  `'todo' | 'done'` stay exact.
- `avi dev` compiles in its own process instead of running `tsc --watch`. With type errors at
  startup it keeps watching and starts the app after the first clean build, instead of exiting.
- New projects build with `avi build` (`build` and `test` scripts): it updates `api.gen.ts`, empties
  `dist/` and compiles, in one TypeScript pass. `tsc` never removes output, so after deleting a
  module `npm test` still ran its compiled tests. It only empties an `outDir` inside the project
  that holds no sources.
- New projects emit declarations (`"declaration": true`), so a React or Vite frontend can import
  `Api` from `dist/api.gen.d.ts`. Importing `src/api.gen.ts` made the frontend's compiler check
  the server's code under Vite's settings, which fails. Chapter 15 shows the setup.

### Fixed

- `cluster()` with the default logger printed its fields object after the ready line
  (`… ready in 493 ms { workers: 2, … }`). Only a logger you pass gets the structured entry.

- `generateOpenApi`: `toJsonSchema` may return any object, so `@valibot/to-json-schema` fits
  without a cast, as chapter 11 shows it. The documented setup did not compile before.

### Docs

- Chapter 12: the rate-limit memory store drops the least recently used key, not the oldest.
- Chapters 7 and 16: in-memory events for `sse()` reach only one process, so they break under
  `cluster()`; chapter 7 adds a per-item live feed with `node:events`.

## 0.5.3 - 2026-10-26

### Fixed

- Shutdown no longer resets connections accepted just before it. On Node 26, closing an HTTP server
  also closes connections whose request has not arrived yet, so during a rolling restart a
  connection handed to a stopping worker could be reset (`ECONNRESET`). `close()` now refuses new
  connections first (in a cluster, Node hands them to another worker), gives connections that are
  already open up to a second to send their request, answers it with `connection: close`, and then
  closes as before. Under load on Node 26, a rolling-restart run went from 7 resets in 21 473
  requests to none in 18 416.

## 0.5.2 - 2026-10-26

Fixes from the security review of everything added since 0.2.0. Upgrade recommended.

### Fixed

- **Security:** error responses no longer keep a handler's `content-type`, `content-encoding`,
  caching or other body headers. After `ctx.setHeader('content-type', 'text/html')`, an
  `HttpError` message built from user input was served as HTML (reflected XSS). Errors are now
  always JSON; other headers, such as request ids and `content-security-policy`, stay.
- **Security:** `defineConfig` errors could still contain a secret when the schema changed the
  value before the failing check (`trim`, `toLowerCase`, a JSON transform) or when a transform threw.
  Quoted text in messages is now redacted, and a throwing schema reports no original error.
- **Security:** `@avijs/client` refuses empty path parameters, which reached the parent route
  (`DELETE /users/` is `DELETE /users`), and empty wildcard segments, which with a relative
  `baseUrl` could send the request to another host. A `baseUrl` with a query or fragment is refused.
- Validation errors are bounded: at most 50 issues (`truncated: true` beyond), messages up to 300
  characters, paths up to 32 keys. A body producing ~150 000 issues used to overflow the stack and
  answer `500`.
- The rate-limit memory store keeps keys in least-recently-used order, so a flood of new keys
  cannot reset a counter that is still in use.
- `ctx.ip` drops a port from forwarded addresses and falls back to the socket address for entries
  that are not IP addresses.
- A thrown value that cannot be converted to a string, or a logger that throws, no longer crashes
  the process or leaves the request without a response.
- A web `Response` with several `Set-Cookie` headers sends all of them, not only the last.
- `sse()` names the problem when event data cannot be serialized, and refuses a `retry` that is
  not a safe integer.
- `avi client` escapes route paths in the generated file (a quote in a path broke it, or added
  code), and leaves out routes whose method is not an HTTP method (AVI107).
- `@avijs/workers`: messages the app's own code sends over IPC are ignored instead of crashing the
  primary; replacements that cannot start count as crashes, so the cluster stops with exit code 1
  instead of running with no workers.

### Docs

- `SECURITY.md` brought up to date, and a new `security/` folder with the threat model, the review
  checklist and a guide for reviewers.
- Notes on validation messages quoting input, incoming request ids, logging, CORS matchers, rate
  limits for IPv6 and client-chosen keys, and which parts `accept` applies to.

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
