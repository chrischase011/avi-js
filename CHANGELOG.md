# Changelog

All notable changes are listed here. Avi.js follows [Semantic Versioning](https://semver.org); all
packages share one version.

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
