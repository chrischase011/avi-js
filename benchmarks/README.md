# Benchmarks

Local measurements for tracking Avi.js against itself and against a hand-written `node:http`
server. They are **not** performance claims. Comparisons with Fastify, Hono and NestJS come later,
with a dedicated setup.

## Running

```sh
pnpm bench:router   # Router.find micro-benchmarks (mitata)
pnpm bench:http     # HTTP load test (autocannon), Avi vs node:http
```

`bench:http` options, as environment variables:

| Variable            | Default | Meaning                           |
| ------------------- | ------- | --------------------------------- |
| `BENCH_CONNECTIONS` | `100`   | Concurrent connections            |
| `BENCH_WARMUP`      | `3`     | Warm-up seconds, discarded        |
| `BENCH_RUNS`        | `3`     | Measured runs; the median is kept |
| `BENCH_DURATION`    | `10`    | Seconds per measured run          |

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

## Baseline results (Phase 2)

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

## Reading these numbers

- Run-to-run noise on this machine is large. Between two router runs, the encoded-param probe
  moved from about 470 ns to about 800 ns. Both servers did more requests per second on the
  param case than on the simpler hello case, which also points to noise (turbo boost, thermal
  state, ordering), not to a real difference.
- The load generator shares the machine with the server, so the HTTP numbers are capped by
  autocannon as much as by the server.
- The gap between Avi.js and `node:http` here (about 1–3%) is within that noise. Do not quote it.
- autocannon reports latency in whole milliseconds, which hides sub-millisecond differences.
- Hello-world workloads say little about real applications. Phase 7 adds realistic workloads,
  allocation profiling and repeated runs on a quiet machine.

## Known costs to revisit in Phase 7

- `find` allocates per request: the split segment array, the params object and the match result.
- Static routes walk the trie segment by segment; a direct lookup for fully static paths could skip
  that.
- Percent-decoding uses `decodeURIComponent` per encoded segment.
