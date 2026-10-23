# Benchmarks

Local measurements for tracking Avi.js against itself and against a hand-written `node:http`
server, Fastify, Hono and NestJS. They are **not** performance claims.

## Running

```sh
pnpm bench:http      # HTTP load test (autocannon), interleaved rounds: Avi, node:http, Fastify, Hono, NestJS
pnpm bench:inproc    # Avi's whole request path in one process, without TCP (mitata)
pnpm bench:profile echo   # CPU profile of the Avi server under load, top functions by self time
pnpm bench:baseline  # save the current build; then BENCH_SERVERS=baseline,avi pnpm bench:http
pnpm bench:router    # Router.find micro-benchmarks (mitata)
pnpm bench:startup   # init() time for 100 modules, 1,000 providers, 1,000 routes
```

`bench:http` options, as environment variables:

| Variable            | Default | Meaning                                                                                                      |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `BENCH_ROUNDS`      | `5`     | Rounds; every server runs once per round, in a new random order                                              |
| `BENCH_DURATION`    | `10`    | Seconds per server per round                                                                                 |
| `BENCH_WARMUP`      | `3`     | Warm-up seconds per server, discarded                                                                        |
| `BENCH_CONNECTIONS` | `100`   | Concurrent connections                                                                                       |
| `BENCH_SERVERS`     | all     | Servers to run: `node`, `avi`, `avi-defaults`, `fastify`, `hono`, `nest-express`, `nest-fastify`, `baseline` |
| `BENCH_CASES`       | all     | Cases to run: `hello`, `param`, `list`, `echo`, `orders`, `validated`                                        |
| `BENCH_PIN`         | on      | `0` turns off pinning servers and the load generator to separate CPU halves                                  |

Each run is saved to `results/` (not committed) with the machine, Node version, git commit and
settings.

## Method

**HTTP** (`src/http.ts`). Each server runs in its own child process; autocannon runs in the parent
on the same machine, pinned to the other half of the CPUs.

- **Same answers first.** Before any load, every server's response to each case (status, JSON
  body, `location`) is compared with `node:http`'s; a difference stops the run.
- **Interleaved rounds.** After a warm-up, every server runs once per round in a new random order,
  so heat and turbo boost spread evenly instead of favoring whoever runs first.
- **A canary.** `node:http` runs in every round. A round where it falls more than 15% below its
  own median is dropped for every server: the machine was busy.
- **Median and range.** Requests per second are reported as the median and the min–max range of
  the kept rounds. When two servers' ranges overlap, the run shows no difference between them,
  whatever the medians say, and the output says so.
- **CPU per request.** Each server reports its own user and system CPU time; divided by the
  requests it served, that is the work per request, steadier than throughput on a busy machine.

| Case        | Request                                 | Response                                     |
| ----------- | --------------------------------------- | -------------------------------------------- |
| `hello`     | `GET /`                                 | `{"hello":"world"}`                          |
| `param`     | `GET /users/123`                        | `{"id":"123"}`                               |
| `list`      | `GET /list`                             | 50 users, about 6 KB of JSON                 |
| `echo`      | `POST /echo` with a 3-field JSON body   | The body                                     |
| `orders`    | `POST /orders`, bearer token, JSON body | `201`, `location` header, the body and an id |
| `validated` | `POST /validated`, same body as `echo`  | The body, after a Valibot schema (Avi only)  |

Every server also registers the rest of a 40-route REST-style table (`src/routes.ts`), so routers
do real work; `node:http` uses `if` checks instead. The Avi server runs with request ids off, like
the others; `avi-defaults` keeps them on. Remaining differences: Hono sends `application/json`
without `charset`, Avi.js and `node:http` add `x-content-type-options`, NestJS checks the token
in a guard class, Fastify in a `preHandler`, Hono in a middleware.

**In one process** (`src/inproc.ts`). Real `IncomingMessage` and `ServerResponse` objects over a
socket that discards its output go through Avi's request handler, so routing, context, pipeline,
body reading and the response run without TCP. With a saved baseline, both builds run side by
side.

**Router** (`src/router.ts`): `Router.find` against the 40-route table with static, parameter and
catch-all routes. mitata handles warm-up, iteration counts and dead-code elimination.

## Results (0.4.0)

Recorded on 2026-10-23. Windows 11 laptop, 13th Gen Intel Core i5-13420H (12 logical CPUs),
Node.js 24.21.0, mains power. 100 connections, 5 rounds × 5 s after a 3 s warm-up, pinned.
Fastify 5.12.7, Hono 4.13.13 on `@hono/node-server` 2.1.5, NestJS 12.2.0.

### HTTP

| Case     | Server           | Req/s (median) | Range         | CPU µs/req |
| -------- | ---------------- | -------------: | ------------- | ---------: |
| `param`  | `node:http`      |         20,563 | 18,172–22,866 |       34.1 |
| `param`  | Avi.js           |         19,016 | 15,887–20,510 |       39.4 |
| `param`  | Fastify          |         17,648 | 16,143–25,530 |       44.1 |
| `param`  | Hono             |         18,386 | 14,225–21,746 |       46.8 |
| `param`  | NestJS (Express) |         13,812 | 9,128–15,026  |       67.6 |
| `param`  | NestJS (Fastify) |         17,206 | 6,500–20,210  |       52.6 |
| `list`   | `node:http`      |         25,589 | 23,819–27,806 |       39.4 |
| `list`   | Avi.js           |         24,160 | 21,461–25,272 |       41.2 |
| `list`   | Fastify          |         24,419 | 20,251–24,827 |       41.1 |
| `list`   | Hono             |         23,563 | 21,342–24,184 |       41.3 |
| `list`   | NestJS (Express) |         16,395 | 15,762–17,086 |       60.9 |
| `list`   | NestJS (Fastify) |         22,198 | 21,672–22,846 |       45.3 |
| `echo`   | `node:http`      |         36,555 | 35,261–39,485 |       26.1 |
| `echo`   | Avi.js           |         32,251 | 26,261–33,088 |       30.4 |
| `echo`   | Fastify          |         34,218 | 24,744–36,029 |       28.2 |
| `echo`   | Hono             |         31,925 | 25,912–33,229 |       30.2 |
| `echo`   | NestJS (Express) |         18,629 | 17,991–18,910 |       54.7 |
| `echo`   | NestJS (Fastify) |         27,240 | 13,529–27,512 |       35.9 |
| `orders` | `node:http`      |         25,737 | 18,914–33,077 |       36.1 |
| `orders` | Avi.js           |         24,536 | 13,183–31,883 |       42.8 |
| `orders` | Fastify          |         24,210 | 15,767–32,074 |       39.3 |
| `orders` | Hono             |         22,091 | 10,580–26,373 |       43.3 |
| `orders` | NestJS (Express) |         12,842 | 9,396–18,341  |       75.9 |
| `orders` | NestJS (Fastify) |         26,606 | 16,034–27,934 |       37.6 |

What this run shows, and only this:

- **Every server answered every request, with no errors,** and all of them answered alike.
- **Where the ranges do not overlap:** Avi.js was faster than NestJS on Express on `param`, `list`
  and `echo`, and slower than `node:http` on `echo` (about 12% fewer requests per second, 4 µs
  more CPU per request).
- **Everything else overlaps,** including Avi.js against Fastify, Hono and NestJS on Fastify in
  every case: no difference shown. The `hello` case is left out of the table because its ranges
  spanned 4,842–40,120 req/s; the laptop throttled during it.
- **Rounds were dropped** in four of the six cases because `node:http` fell more than 15% below its
  median. This is a laptop with other applications open. Ranking frameworks needs a quiet,
  dedicated machine.

### Avi.js in one process

`pnpm bench:inproc`, same laptop, time per request through Avi's whole request handler without
TCP:

| Case    | Time per request |
| ------- | ---------------: |
| `hello` |       about 3 µs |
| `param` |     about 3.3 µs |
| `echo`  |        7 to 8 µs |
| `list`  |      about 21 µs |

On `list`, `JSON.stringify` of the 50 users alone takes about 19.5 µs: serializing the response is
almost all of Avi's work there. A CPU profile of the `echo` case under load puts about 9% of the
samples in `@avijs` code; the rest is Node's HTTP layer, the socket and V8.

### Reading a JSON body (0.4.0)

`src/body.ts` measures the operations behind `ctx.json()` before and after the 0.4.0 change, two
runs:

| Operation                   |     Before |      After |
| --------------------------- | ---------: | ---------: |
| Join a one-chunk body       |  72–124 ns | under 1 ns |
| Check `application/json`    |   20–22 ns | under 1 ns |
| `ctx.json()` on a read body | 599–703 ns | 558–588 ns |

That saves about 0.2 µs per JSON request, about 3% of Avi's own work on `echo`: real, and far too
small for an HTTP run on this machine to show.

## Earlier results

Before 0.4.0, servers ran one after another in a fixed order and the median of 3 runs was kept.
Read these with the warnings that come with them.

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

### Validation overhead (0.1.0)

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
20% between this run and the first baseline with no related code change.

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

### Static-route fast path (0.1.0)

A direct lookup was added for routes without parameters, checked before the trie. It was
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

### Startup (0.1.0)

`pnpm bench:startup` defines and initializes an app with 100 modules, 1,000 factory providers in
dependency chains and 1,000 routes, 20 times in one process.

| Run                   |    Time |
| --------------------- | ------: |
| First (cold JIT)      |  ~11 ms |
| Median of the next 19 | ~3.7 ms |

Two runs gave 10.2 / 3.6 ms and 11.6 / 3.8 ms.

### Manifest verification (0.1.0)

`BENCH_MANIFEST=1 pnpm bench:startup` builds a manifest with `describeApp()` and passes it to
`createAvi({ manifest })`, inside the timed section.

| Mode             | First (cold) | Median of next 19 |
| ---------------- | -----------: | ----------------: |
| No manifest      | 10.4–11.9 ms |        3.9–4.1 ms |
| Manifest checked | 14.8–15.5 ms |        6.0–7.5 ms |

The timing includes building the manifest, which a real deployment does at build time, so it
overstates the cost. Either way, verifying a manifest adds work and does not speed startup up.

### Reading these numbers

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
  0.1.0.
- Percent-decoding uses `decodeURIComponent` per encoded segment.
- Serializing responses: `JSON.stringify` is most of the work on list endpoints (about 19.5 µs of
  21 µs for 50 users in one process). A serializer compiled from the route's `response` schema is
  the next candidate.
- The interleaved run above showed `node:http` ahead of Avi.js on `echo` by about 4 µs of CPU per
  request; worth a profile on a quiet machine.
