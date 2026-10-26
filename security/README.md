# Security review guide

Thank you for reviewing Avi.js. This folder is the starting point:

- [threat-model.md](threat-model.md): what Avi.js defends, what it leaves to applications, and the
  trust boundaries in between.
- [checklist.md](checklist.md): each area's controls, the tests behind them, what was fixed in the
  internal review, and what is knowingly left open.
- [../SECURITY.md](../SECURITY.md): the public policy, defaults and how to report a vulnerability.

## What we would like you to look at

In order of exposure to untrusted input:

1. **The request path** in `packages/http/src`: `server.ts` (request handling, ids, errors),
   `context.ts` (bodies, query, `ctx.ip`), `respond.ts` (serialization and error responses),
   `router.ts` (matching and decoding), `sse.ts`.
2. **Validation** in `packages/validation/src/validate.ts`: what a `400` can contain.
3. **Uploads** in `packages/multipart/src/index.ts`, built on `@fastify/busboy`.
4. **`@avijs/security`**: headers, CORS and rate limiting.
5. **The typed client** in `packages/client/src/index.ts`: what user input passed as params can do.
6. **Config** in `packages/core/src/config.ts`: secrets in error messages.
7. **Workers** and the **generators** (`packages/workers`, `packages/cli`, `packages/compiler`), which
   are reachable only by the application's developer.

Findings we already know about are listed as open in the checklist; please tell us if you think
any of them should not be.

## Running things

```sh
pnpm install
pnpm verify                         # format, lint, types, build, every test, example smoke checks
pnpm verify:artifacts               # packs the packages and installs them in a clean project
FUZZ_RUNS=5000 pnpm test            # longer fuzz runs (router, multipart, SSE, client paths)
```

The fuzzers are `http/fuzz.test.ts` (raw requests), `http/router.property.test.ts`,
`http/sse.property.test.ts`, `multipart/multipart.test.ts` and
`client/fill-path.property.test.ts`, all with fast-check.

## History

- **2026-10-22**: first internal review, before 0.2.0.
- **2026-10-26**: second internal review, of everything added since: config, request ids,
  `trustProxy`, rate limiting, uploads, SSE, logging, the typed client and its generator, and
  workers. It found and fixed:
  - client path parameters reaching other routes (advisory GHSA-wxm7-p3mw-qwv2, fixed in 0.5.1 and
    0.5.2);
  - error responses keeping a handler's `content-type` (reflected XSS when it was HTML);
  - config secrets surviving redaction after a transform;
  - unbounded and crashing validation errors;
  - a rate-limit store that a key flood could reset;
  - several robustness issues.

Both reviews were done by the project's own developers and tools. An independent review is what
this guide is for.

## Reporting

Report anything you find privately, as described in [SECURITY.md](../SECURITY.md#reporting-a-vulnerability).
