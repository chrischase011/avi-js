# Benchmarks

Local measurements for tracking Avi.js against itself and against a hand-written `node:http`
server, Fastify, Hono and NestJS. They are **not** performance claims.

## Running

```sh
pnpm bench:router   # Router.find micro-benchmarks (mitata)
pnpm bench:http     # HTTP load test (autocannon): Avi, node:http, Fastify, Hono, NestJS
pnpm bench:startup  # init() time for 100 modules, 1,000 providers, 1,000 routes
```

`bench:http` options, as environment variables:

| Variable            | Default | Meaning                                                                                          |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `BENCH_CONNECTIONS` | `100`   | Concurrent connections                                                                           |
| `BENCH_WARMUP`      | `3`     | Warm-up seconds, discarded                                                                       |
| `BENCH_RUNS`        | `3`     | Measured runs; the median is kept                                                                |
| `BENCH_DURATION`    | `10`    | Seconds per measured run                                                                         |
| `BENCH_SERVERS`     | all     | Comma-separated servers to run: `node`, `avi`, `fastify`, `hono`, `nest-express`, `nest-fastify` |

## Method

**Router** (`src/router.ts`): `Router.find` against a 40-route REST-style table
(`src/routes.ts`) with static, parameter and catch-all routes. mitata handles warm-up, iteration
counts and dead-code elimination.

**HTTP** (`src/http.ts`): each server runs in its own child process; autocannon runs in the parent
on the same machine. Both servers answer the same two requests with identical bodies and headers
(`content-type`, `content-length`, `x-content-type-options`):

| Case            | Request          | Response            |
| --------------- | ---------------- | ------------------- |
| JSON hello      | `GET /`          | `{"hello":"world"}` |
| JSON with param | `GET /users/123` | `{"id":"123"}`      |

The Avi server also registers the rest of the 40-route table, so the router does real work. The
`node:http` server uses `if` checks and string slicing instead of a router.

Two more cases run on the Avi server only, to measure validation overhead. Both `POST` the same
body, `{"name":"Ada","email":"ada@example.com","age":36}`, and echo it back:

| Case                 | Route             | Work                                                   |
| -------------------- | ----------------- | ------------------------------------------------------ |
| POST JSON, no schema | `POST /echo`      | `ctx.json()`                                           |
| POST JSON, validated | `POST /validated` | Valibot `object` with string, email and integer checks |

## Baseline results

Recorded on 2026-10-22. Windows 11 laptop, 13th Gen Intel Core i5-13420H (12 logical CPUs),
Node.js 24.21.0, on mains power, other applications open.

### Router.find, 40 routes

| Probe              | Path                             | Time per lookup |
| ------------------ | -------------------------------- | --------------: |
| static root        | `/`                              |           51 ns |
| static beats param | `/users/me`                      |          206 ns |
| miss (404)         | `/nope/nothing/here`             |          207 ns |
| trailing slash     | `/users/123/`                    |          247 ns |
| one param          | `/users/123`                     |          261 ns |
| static deep        | `/api/v1/users/settings/profile` |          374 ns |
| catch-all          | `/files/a/b/c.txt`               |          394 ns |
| two params         | `/users/123/posts/456`           |          394 ns |
| deep params        | `/teams/7/members/42/roles`      |          418 ns |
| encoded param      | `/users/caf%C3%A9`               |          797 ns |

### HTTP, 100 connections, median of 3 × 10 s runs

| Case            | Server      |  Req/s | p50  | p90  | p99  | Errors |
| --------------- | ----------- | -----: | ---- | ---- | ---- | -----: |
| JSON hello      | `node:http` | 45,875 | 1 ms | 3 ms | 5 ms |      0 |
| JSON hello      | Avi.js      | 45,437 | 1 ms | 3 ms | 5 ms |      0 |
| JSON with param | `node:http` | 51,865 | 1 ms | 2 ms | 5 ms |      0 |
| JSON with param | Avi.js      | 50,169 | 1 ms | 2 ms | 4 ms |      0 |

### Validation overhead (Phase 6)

Recorded on 2026-10-22, same machine and settings, after middleware and validation were added.

| Case                 | Server      |  Req/s | p50  | p90  | p99   | Errors |
| -------------------- | ----------- | -----: | ---- | ---- | ----- | -----: |
| JSON hello           | `node:http` | 50,329 | 1 ms | 2 ms | 4 ms  |      0 |
| JSON hello           | Avi.js      | 51,009 | 1 ms | 2 ms | 4 ms  |      0 |
| JSON with param      | `node:http` | 53,654 | 1 ms | 2 ms | 3 ms  |      0 |
| JSON with param      | Avi.js      | 43,444 | 1 ms | 3 ms | 7 ms  |      0 |
| POST JSON, no schema | Avi.js      | 38,457 | 2 ms | 3 ms | 4 ms  |      0 |
| POST JSON, validated | Avi.js      | 29,056 | 2 ms | 5 ms | 10 ms |      0 |

On this run, validating the three-field body cost about 25% of throughput against the same route
without a schema. Treat that as an order of magnitude, not a figure: the param case moved by about
20% between this run and the Phase 2 baseline with no related code change.

A run just before this one was discarded: `node:http` fell to 19,680 req/s on the hello case and
the validated route came out faster than the unvalidated one, which only happens when something
else is competing for the CPU.

### Framework comparison (0.1.0)

`pnpm bench:http` now also runs Fastify 5.12.7, Hono 4.13.13 on `@hono/node-server` 2.1.5, and
NestJS 12.2.0 on Express and on Fastify. Every server registers the same 40-route table and answers
the benchmark routes with the same status and JSON body; a check script compared their responses
before the run. NestJS's `POST` is set to `200` to match the others. Differences that remain: Hono
sends `application/json` without `charset`, Avi.js and `node:http` add `x-content-type-options`,
and the body limits differ (Avi.js and Fastify 1 MiB, Nest on Express 100 KiB, Hono none).

Recorded on 2026-10-22, same laptop, Node.js 24.21.0, 100 connections, median of 3 × 10 s runs:

| Case            | Server           |  Req/s | p50  | p90   | p99   | Errors |
| --------------- | ---------------- | -----: | ---- | ----- | ----- | -----: |
| JSON hello      | `node:http`      | 50,739 | 1 ms | 2 ms  | 4 ms  |      0 |
| JSON hello      | Avi.js           | 16,954 | 5 ms | 7 ms  | 13 ms |      0 |
| JSON hello      | Fastify          | 19,994 | 5 ms | 6 ms  | 9 ms  |      0 |
| JSON hello      | Hono             | 18,342 | 5 ms | 7 ms  | 11 ms |      0 |
| JSON hello      | NestJS (Express) | 10,785 | 9 ms | 13 ms | 21 ms |      0 |
| JSON hello      | NestJS (Fastify) | 19,257 | 5 ms | 8 ms  | 11 ms |      0 |
| JSON with param | `node:http`      | 23,112 | 4 ms | 6 ms  | 9 ms  |      0 |
| JSON with param | Avi.js           | 22,979 | 4 ms | 6 ms  | 12 ms |      0 |
| JSON with param | Fastify          | 24,525 | 3 ms | 6 ms  | 10 ms |      0 |
| JSON with param | Hono             | 22,472 | 4 ms | 6 ms  | 14 ms |      0 |
| JSON with param | NestJS (Express) | 13,584 | 6 ms | 12 ms | 16 ms |      0 |
| JSON with param | NestJS (Fastify) | 28,528 | 2 ms | 7 ms  | 10 ms |      0 |
| POST JSON echo  | `node:http`      | 43,100 | 2 ms | 3 ms  | 4 ms  |      0 |
| POST JSON echo  | Avi.js           | 25,922 | 2 ms | 6 ms  | 23 ms |      0 |
| POST JSON echo  | Fastify          | 42,020 | 2 ms | 2 ms  | 4 ms  |      0 |
| POST JSON echo  | Hono             | 29,212 | 2 ms | 4 ms  | 10 ms |      0 |
| POST JSON echo  | NestJS (Express) | 20,683 | 4 ms | 5 ms  | 10 ms |      0 |
| POST JSON echo  | NestJS (Fastify) | 34,073 | 2 ms | 3 ms  | 7 ms  |      0 |
| POST, validated | Avi.js           | 35,784 | 2 ms | 3 ms  | 5 ms  |      0 |

**This run does not rank the frameworks.** The laptop throttled after the first server: `node:http`
did 50,739 req/s on the hello case and every framework after it landed between 11k and 20k,
including NestJS on Fastify, which does more work per request. Avi.js then did more requests per
second on the param route than on the simpler hello route, and the validated `POST` beat the
identical unvalidated one. Servers run one after another in a fixed order, so whatever runs while
the machine is hot or cool wins or loses for reasons unrelated to the code.

What it does show: every server answered every request without errors under the same load. To
compare throughput, rerun on a dedicated machine with frequency scaling fixed, ideally with the
load generator on a second machine. `BENCH_SERVERS=avi,fastify pnpm bench:http` limits a run to
some servers.

### Static-route fast path (Phase 7)

Phase 7 added a direct lookup for routes without parameters, checked before the trie. It was
measured as an A/B: the old and new `Router` builds were loaded into one process and benchmarked
in pairs on the same probes.

| Probe              | Before | After |
| ------------------ | -----: | ----: |
| static root        |  53 ns | 11 ns |
| static deep        | 440 ns | 12 ns |
| static beats param | 197 ns | 12 ns |

Parameter routes first looked 20–50% slower with the fast path. Swapping which router ran first
reversed that: whichever ran second was slower. That difference is a benchmark-order effect, not
the change; the static-route gain held in both orders.

### Startup (Phase 7)

`pnpm bench:startup` defines and initializes an app with 100 modules, 1,000 factory providers in
dependency chains and 1,000 routes, 20 times in one process.

| Run                   |    Time |
| --------------------- | ------: |
| First (cold JIT)      |  ~11 ms |
| Median of the next 19 | ~3.7 ms |

Two runs gave 10.2 / 3.6 ms and 11.6 / 3.8 ms.

### Manifest verification (Phase 8)

`BENCH_MANIFEST=1 pnpm bench:startup` builds a manifest with `describeApp()` and passes it to
`createAvi({ manifest })`, inside the timed section.

| Mode             | First (cold) | Median of next 19 |
| ---------------- | -----------: | ----------------: |
| No manifest      | 10.4–11.9 ms |        3.9–4.1 ms |
| Manifest checked | 14.8–15.5 ms |        6.0–7.5 ms |

The timing includes building the manifest, which a real deployment does at build time, so it
overstates the cost. Either way, verifying a manifest adds work and does not speed startup up.

## Reading these numbers

- Run-to-run noise on this machine is large. Between two router runs, the encoded-param probe
  moved from about 470 ns to about 800 ns. Both servers did more requests per second on the
  param case than on the simpler hello case, which also points to noise (turbo boost, thermal
  state, ordering), not to a real difference.
- The load generator shares the machine with the server, so the HTTP numbers are capped by
  autocannon as much as by the server.
- The gap between Avi.js and `node:http` here (about 1–3%) is within that noise. Do not quote it.
- autocannon reports latency in whole milliseconds, which hides sub-millisecond differences.
- Hello-world workloads say little about real applications. Treat every number here as a
  local measurement until it is repeated on dedicated hardware.

### Parameter-route lookup (0.1.0)

`find` used to create a closure on every parameter-route lookup to pick the method. It now passes
the method string down instead. A/B in one process, same probes, both orders:

| Probe          | New first: old / new | Old first: old / new |
| -------------- | -------------------: | -------------------: |
| one param      |         644 / 503 ns |       1,140 / 981 ns |
| two params     |         505 / 338 ns |         382 / 355 ns |
| deep params    |         515 / 386 ns |         385 / 383 ns |
| encoded param  |         572 / 442 ns |         473 / 438 ns |
| catch-all      |         529 / 351 ns |         469 / 663 ns |
| trailing slash |         588 / 281 ns |         634 / 572 ns |

The machine was busy during these runs (one param took 2–4× its baseline), and the catch-all probe
flipped between orders. Read this as "no slower, probably a little faster", not as a figure. The
change is kept because it removes an allocation and simplifies the code.

## Known costs to revisit in the future

- For parameter routes, `find` still allocates per request: the split segment array, the matched
  values, the params object and the match result. Fully static routes allocate nothing since
  Phase 7.
- Percent-decoding uses `decodeURIComponent` per encoded segment.
