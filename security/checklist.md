# Review checklist

Each area lists what Avi.js promises, the tests that hold it to that, and what is known to be
open. Test names are `file › test` under `packages/*/test/`. Findings from the 2026-10-26 internal
review are marked **fixed** with the version that fixes them.

## HTTP parsing and bodies

| Control                                                      | Tests                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Body limit on the declared length and while streaming; `413` | `http/server.test.ts` › 413 tests                         |
| Malformed JSON `400`, wrong type `415`                       | `http/server.test.ts` › "rejects malformed JSON with 400" |
| Strict parser; random raw requests never crash or 5xx        | `http/fuzz.test.ts`, `http/hostile.test.ts`               |
| Timeouts close slow clients (`408`)                          | `http/hostile.test.ts`                                    |
| Malformed percent-encoding `400`; no dot-segment resolution  | `http/router.property.test.ts`, `http/router.test.ts`     |

## Responses and errors

| Control                                                                            | Tests                                                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 5xx never send messages, causes or stacks                                          | `http/server.test.ts` › "hides thrown errors behind a generic 500 and logs them"                             |
| Errors are JSON even after `ctx.setHeader('content-type', …)` (**fixed in 0.5.2**) | `http/server-pipeline.test.ts` › "sends errors as JSON even when the handler had set a body type or caching" |
| Security headers such as CSP stay on error responses                               | `security/headers.test.ts` › "sends safe defaults on responses and errors"                                   |
| Header values validated; CRLF never reaches the wire                               | `http/server-pipeline.test.ts` › "rejects invalid headers where they are set"                                |
| Every `Set-Cookie` of a web `Response` is sent (**fixed in 0.5.2**)                | `http/streaming.test.ts` › "keeps every Set-Cookie of a web Response"                                        |
| Any thrown value, and a throwing logger, still give a `500` (**fixed in 0.5.2**)   | `http/server-pipeline.test.ts` › "answers 500 whatever is thrown and whatever the logger does"               |
| HEAD answered without a body; OPTIONS `204` with `Allow`                           | `http/server.test.ts`, `http/streaming.test.ts`                                                              |

## Validation

| Control                                                                                              | Tests                                                                                               |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Every issue reported as one `400`; handler not run                                                   | `validation/validate.test.ts` › "reports every issue from every part as one 400"                    |
| A `400` is bounded: 50 issues, 300-character messages (**fixed in 0.5.2**; a large body used to 500) | `validation/validate.test.ts` › "bounds what a 400 sends back, however many issues the body causes" |
| Response schemas drop undeclared fields; mismatch is a logged `500`                                  | `validation/validate.test.ts` › "sends the schema output, dropping undeclared fields"               |

Open: messages come from the schema library and may quote the input (Valibot does). Documented in
chapter 6; applications can set their own messages.

## Server-sent events

| Control                                                                             | Tests                                                                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A client reads back exactly the events sent; names and ids with line breaks refused | `http/sse.property.test.ts` (fuzzed), `http/sse.test.ts`                                 |
| Unserializable data and unsafe `retry` fail with a clear error (**fixed in 0.5.2**) | `http/sse.test.ts` › "names the problem when data cannot be sent, or retry is too large" |
| Disconnects abort the source and run its `finally`; backpressure                    | `http/sse.test.ts`                                                                       |

## Config

| Control                                                                             | Tests                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Errors never contain values, even after a transform or a throw (**fixed in 0.5.2**) | `core/config.test.ts` › "keeps values out of errors even after a transform, or when the schema throws" |
| `.env` parsing cannot pollute prototypes                                            | Checked in review; no test                                                                             |

## Proxies, client addresses and request ids

| Control                                                                   | Tests                                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `X-Forwarded-For` ignored by default; hop counting from the socket        | `http/ip.test.ts`                                                                                  |
| Ports dropped, non-addresses fall back to the socket (**fixed in 0.5.2**) | `http/ip.test.ts` › "drops ports and falls back to the socket for anything that is not an address" |
| Incoming request ids: 1–128 visible ASCII characters, else generated      | `http/request-id.test.ts`                                                                          |

Open, documented: incoming ids are trusted by default (`trustIncoming: false` to generate always).

## Rate limiting and CORS

| Control                                                                   | Tests                                                                                                       |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `429` with `Retry-After`; exact under concurrency; store failures handled | `security/rate-limit.test.ts`                                                                               |
| Memory store bounded; a key in use survives a flood (**fixed in 0.5.2**)  | `security/rate-limit.test.ts` › "keeps a key that is still in use when a flood of new keys fills the store" |
| CORS: only listed origins; `'*'` with credentials refused; `Vary: Origin` | `security/cors.test.ts`                                                                                     |

Open, documented: fixed windows allow a burst of twice the limit at a window edge; IPv6 clients can
rotate within a `/64`; broad CORS functions or expressions with credentials.

## Uploads

| Control                                                                   | Tests                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Limits enforced while reading (`413`); malformed bodies `400`; no hangs   | `multipart/multipart.test.ts` (fuzzed: "never fails with a 500 or hangs on arbitrary bodies") |
| `accept` answers `415` before a file is read                              | `multipart/multipart.test.ts` › "stops at the first file of a type accept does not list"      |
| File names without directories; fields named `__proto__` are plain fields | `multipart/multipart.test.ts`                                                                 |

Open, documented: `accept` applies to file parts; a part without a file name or type is a field.

## Typed client

| Control                                                                                                                             | Tests                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A param fills exactly its own segment or is refused (`.`, `..`, empty) (**fixed in 0.5.1 and 0.5.2**; advisory GHSA-wxm7-p3mw-qwv2) | `client/fill-path.property.test.ts` (fuzzed), `client/client.test.ts`                        |
| Errors never include request headers or tokens                                                                                      | `client/client.test.ts` › "throws AviClientError with the status, error body and request id" |
| `baseUrl` with a query or fragment refused (**fixed in 0.5.2**)                                                                     | `client/client.test.ts` › "refuses a baseUrl the path would be appended to the query of"     |

## Generators and tools

| Control                                                                              | Tests                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `avi new` and `avi generate` only write inside the project and never overwrite       | `cli/cli.test.ts` › "refuses to overwrite a non-empty folder", "previews with --dry-run, refuses to overwrite and validates input" |
| `avi client` output cannot be broken or extended by route paths (**fixed in 0.5.2**) | `compiler/compiler.test.ts` › "escapes paths into valid string literals and skips non-HTTP methods"                                |

## Workers

| Control                                                                                  | Tests                                                                                                                 |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| No request lost during a rolling restart or shutdown (**fixed in 0.5.1**)                | `workers/cluster.test.ts` › "restarts workers one at a time without dropping requests"                                |
| Messages that are not ours are ignored (**fixed in 0.5.2**)                              | `workers/cluster.test.ts` › "ignores IPC messages that are not its own"                                               |
| Crash loops and replacements that cannot start end with exit code 1 (**fixed in 0.5.2**) | `workers/cluster.test.ts` › "stops after too many crashes…", "stops with exit code 1 when replacements cannot start…" |

## Dependencies

| Control                                                    | Where                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm audit --prod` on every push                          | `.github/workflows/ci.yml`                                  |
| Published packages list only reviewed runtime dependencies | `scripts/verify-artifacts.mjs` (CI job "Package artifacts") |
