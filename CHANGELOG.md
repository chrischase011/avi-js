# Changelog

All notable changes are listed here. Avi.js follows [Semantic Versioning](https://semver.org); all
packages share one version.

## 1.0.0-rc.4 - 2026-10-27

Fixes from testing 1.0.0-rc.3: a correctness review of the new dependency lists, a new-user run of
every chapter from npm, the real app on generated lists, and deeper fuzzing.

### Fixed

- A class declared in a file that imports `inject.gen.ts`, such as `app.module.ts` or `main.ts`,
  crashed the app at startup (`Cannot access ... before initialization`), and so did a test that
  registered a feature module before the lists loaded. The generated file now registers a function
  (`registerInjects(() => [...])`) that runs when the app starts, and controllers read their list
  then instead of when their module loads.
- `inject.gen.ts` imported every file with a class, so a seed script or a test helper ran when the
  app started. Only files the app loads are read now: those its entry points (`AviFactory.create`,
  `register`, `createAvi`, `runWorker`, `cluster`) import. With no entry point, nothing is
  inferred and AVI202 says why.
- A subclass of an abstract base had `undefined` dependencies: abstract classes were skipped. They
  get lists now, which subclasses without a constructor inherit.
- An optional or defaulted constructor parameter was inferred as required, so startup failed when
  nothing provided it. Lists stop at the first one, as `constructor.length` does.
- An object with a `description` named like a type was taken for a token. Only classes,
  constructors, and `createToken` and `defineConfig` values are.
- The up-to-date check ignored commas and spaces inside strings, so `[A, B]` matched `[AB]` and a
  changed list could stay stale. Only formatting is ignored now.
- `avi build` removed any compiled-looking file without a source, including one written by hand,
  a bundler's assets and output compiled from outside `include` (a sibling `shared/` folder).
  It now records what it writes and removes only what an earlier build wrote and this one did not.
- A class with no dependency list now says so, and how to fix it, instead of "static inject lists
  0"; counts read "1 constructor argument" and "1 dependency list".
- The minimal template ships `src/inject.gen.ts` too, so `avi inject --check` passes and its
  services can take dependencies without `static inject`.
- `avi inject` and `avi client` write next to the `--project` tsconfig, like `avi dev`.
  `avi g` no longer rewrites `inject.gen.ts` for line endings alone.
- `avi --version` prints the version; `avi g --help` shows the generate usage; the hint for a
  missing `--` names `@next` during a release candidate.

### Docs

- Chapters 3, 8 and 16: an entry point or test that skips `app.module.ts` imports
  `inject.gen.js` itself. Chapter 10 explains which files are read, and AVI202. Chapter 0's
  script table and summary note, chapter 9's minimal tree and chapter 17's CLI list are corrected.
- README: the status badge, the packages table (client, workers) and `@next` during the release
  candidate.

## 1.0.0-rc.3 - 2026-10-27

### Added

- Dependency lists without `static inject`. `avi dev` and `avi build` read constructor types with
  the TypeScript compiler they already run and keep the lists in `src/inject.gen.ts`, a generated
  file like `api.gen.ts`, which the app module imports first. It is plain code, so any test runner
  works, and it changes only when a constructor does. Classes, and tokens named like their type
  (`PrismaClient`, `Config`, `createToken<Db>()` with `interface Db`), are inferred; anything
  else gets a warning (AVI201). A `static inject` in the class wins, so both styles mix. New
  modular projects use it and their classes list nothing.
- `avi inject [--check | --watch]` writes the file once, checks it in CI, or watches without
  compiling. `avi dev` and `avi build` take `--inject <file>` and `--no-inject`. `avi generate`
  updates the file when it adds a class.
- `registerInjects()` in core, what the generated file calls: it sets `static inject` on classes
  that have none.

### Changed

- `@Injectable` and `@Controller` accept a class with constructor parameters and no `static inject`:
  its list comes from `inject.gen.ts`. A written list is still type-checked against the
  constructor. Startup still fails, now with how to fix it, when a class has no list at all.

### Fixed

- `avi build` never removed stale files when the project path ran through a link above the project,
  such as macOS `/var` (a link to `/private/var`) or a Windows short name, as CI runners use. The
  safety check compared whole paths; it now compares the path inside the project, and expected
  outputs by their place in the output folder.

## 1.0.0-rc.2 - 2026-10-27

Fixes from testing 1.0.0-rc.1: a correctness review, a security review, a new-user run of every
chapter from npm, deeper fuzzing and a stress run.

### Security

- `avi build` could delete files outside the project, or folders that were never build output. The
  output folder was emptied after a string check, so a link in its path (a symlink or junction an
  untrusted checkout can carry) led the delete elsewhere, and an `outDir` such as `.git`, `public`
  or one set by an extended config was wiped. It now deletes nothing on the first build in a
  folder, only marks it, and later removes only compiled files (`.js`, `.d.ts`, `.map`) the build
  no longer emits, in a real folder inside the project that is not hidden or `node_modules`, and
  not when the config has errors.
- `avi client`, `avi dev` and `avi build` refuse to overwrite a file they did not generate, so a
  mistyped `--out` or `--client` cannot replace source code.
- `onUpgrade` gives each connection its own `signal`. All connections shared one, so listeners
  added per connection, as chapter 7 shows, were kept for the life of the app: about 10 KB per
  closed connection.
- `api.events()` refuses an event or line larger than `maxEventSize` (default 1 MiB, a new client
  option) and a response that is not `text/event-stream`. A stream without line breaks grew memory
  without limit and took quadratic time.
- `APP` now gives a read-only view with `routes()`, not the app: through `app.get()` a module could
  read providers it was never given, or close the app.

### Added

- `OpenApiModule.forRoot({ guards, middleware })` protects the document, and
  `openapi: { exclude: true }` leaves a route out of it.
- `avi dev` and `avi build` take `--root`, like `avi client`.
- `--help` works for every `avi` command and for `npm create avi`; an unknown option prints the
  usage instead of a stack trace.
- A startup failure that is not shown in a terminal prints one line on stderr, with the failing step
  and the reason; a logger with `info` gets an `Application failed to start` error entry.
  `AviFactory.create`, as the templates use it, reported nothing before.

### Fixed

- Response types from handlers turned into `any` in a frontend compiled without Node types, such
  as a Vite app: a type imported `node:stream`. Only routes with a response schema kept theirs.
- `avi dev --client` with a file outside the TypeScript program never compiled or started the app.
- `avi build` exited 0 when the client could not be generated, leaving it stale.
- `app.get(APP)` and `defineHook({ inject: [APP] })` threw; supplied tokens now resolve there too.
- The test client dropped headers given as a `Headers` object or as `[name, value]` pairs.
- Config errors redacted variable names and allowed values (`Expected "[redacted]"`). Only text
  holding the received value is redacted now; a missing variable's message is shown as is.
- `jsonLogger` printed a plain-object `cause`, such as validation issues, as `[object Object]`.
- On Windows, stopping `avi dev` left the app running and its port taken.
- `npm create avi my-app --template minimal`, without `--`, made a modular app: npm swallows the
  flag. A stray argument is now an error that says to put options after `--`.
- A module made by another copy of `@avijs/core` is named as such in the error. Packages now
  depend on each other with `^` ranges, so npm can share one core across 1.x versions.
- `avi client` no longer warns about modules made by a library, such as
  `OpenApiModule.forRoot(...)`: they have no app routes, like library modules referenced by name.
- A failed `cluster()` start printed its reason twice.
- Generated tests no longer add a second error when their setup fails.

### Docs

- Chapter 12 shows options with `AviFactory.create`, as in the generated `main.ts`; chapter 17 says
  to install every package from `next` during a release candidate; chapter 8 says response
  `headers` is a `Headers`; chapter 7's summary table covers failures and the test client.

## 1.0.0-rc.1 - 2026-10-26

The first release candidate for 1.0. From here, the stable API only gets fixes until 1.0.0; see
the new chapter 17 for what 1.x promises.

### Added

- `onUpgrade(req, socket, head, signal)`: hands upgrade requests, such as WebSockets, to a library
  like `ws`. `signal` aborts when shutdown starts, so connections can close politely; any still
  open after `shutdownTimeout` are destroyed, and upgrades during shutdown get `503`. Chapter 7
  shows WebSockets with `ws`.

### Changed

- `avi dev` runs the app with `NODE_ENV=development` unless you set it, so `cluster()` stays in one
  process during development, as chapter 16 says. It used to start a worker per core.

### Docs

- A pass over every chapter against the final API: examples use `defineFactory` and `ctx.need`,
  the pipeline example no longer overwrites the built-in request id, chapter 9 shows the minimal
  template as generated, chapter 2 says repeated slashes in route definitions are collapsed, and
  several imports, file trees and version banners are corrected.
- Chapter 17, Stability and versions: what semver covers in 1.x, what is experimental or internal,
  deprecations, supported Node.js and TypeScript versions, release channels.
- Chapter 10 marks manifests as experimental.
- Chapter 12 explains that rate limits use fixed windows, and the burst that allows.

### Fixed

- `avi client` names a module it cannot read as `forRoot(...)` on one line, instead of quoting the
  whole call across several lines.

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
