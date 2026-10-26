# 16. Workers and multiple cores

> **Status: Runnable from 0.5.0.** Everything on this page works with Avi.js 0.5.0 or newer.

A Node.js process runs your JavaScript on one CPU core. `@avijs/workers` runs your app on all of
them, and runs background workers that use the same modules and providers without an HTTP server.

```sh
npm install @avijs/workers
```

## Every core: cluster()

Wrap the code that creates and starts the app:

```ts
// src/main.ts
import { AviFactory } from '@avijs/core';
import { cluster } from '@avijs/workers';
import { AppModule } from './app.module.js';

await cluster(async () => {
  const app = await AviFactory.create(AppModule);
  await app.listen(3000);
  return app;
});
```

```text
AVI.JS 0.5.0 · Application bootstrap
...
Avi.js 0.5.0 cluster: 8 workers on http://localhost:3000, ready in 211 ms
```

`cluster()` starts one worker process per CPU core (`workers: 'auto'`), and each one runs the
function: all of them listen on the same port, and Node.js shares incoming connections between
them. The first process, the primary, only manages the workers. It never calls your function, so
it opens no database connections of its own. The first worker prints the startup summary; the
primary prints one line once every worker is ready.

| Situation                                        | What happens                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| A worker crashes                                 | A new one starts                                                     |
| More than 5 crashes within 10 seconds            | The cluster stops and exits with code 1, so your supervisor sees it  |
| `SIGINT` or `SIGTERM`                            | Every worker closes its app, finishing in-flight requests, then exit |
| `SIGHUP` (not on Windows), or `handle.restart()` | Workers restart one at a time: a zero-downtime reload                |
| A worker fails to start                          | `cluster()` rejects with the error and its cause                     |

```ts
const handle = await cluster(start, {
  workers: 4, // or 'auto'
  shutdownTimeout: 10_000, // ms each worker gets to finish on shutdown
  maxRestarts: 5, // crashes within restartWindow before giving up
  restartWindow: 10_000,
});
await handle.restart(); // e.g. after a deploy
```

With `workers: 1`, or `NODE_ENV=development`, the function runs in the same process, so `avi dev`,
debuggers and tests work as before.

### State is per worker

Each worker is a separate process with its own memory. Anything kept in memory exists once per
worker:

- **Rate limits** with the default `memoryStore()` count per worker: a limit of 100 lets a client
  make up to 100 requests per worker. Use a shared store such as Redis for an exact limit.
- **In-memory data** (caches, sessions, the users array in the examples) differs between workers.
  Keep shared data in a database or cache server.
- **Live events** (`sse()`) fed by an in-memory `EventEmitter` reach only the clients of the worker
  that emitted them: a change made through worker A never reaches a browser connected to worker
  B. It is the first thing to break when you add `cluster()`. Publish through Redis pub/sub or
  Postgres `LISTEN`/`NOTIFY` instead ([chapter 7](07-production.md#server-sent-events)).
- **Request-scoped providers** and `ctx.state` are per request, so they are unaffected.

### cluster() or containers?

Both use every core. `cluster()` fits a single server or VM. On Kubernetes or similar platforms,
running one single-process container per core lets the platform do the restarting and balancing,
and needs no `cluster()`.

## Background workers: runWorker()

A queue consumer, a scheduler or a one-off script needs your services and database, but no HTTP
server. `runWorker()` starts the app's providers, runs your function, and closes everything when
it ends:

```ts
// src/worker.ts
import { runWorker } from '@avijs/workers';
import { AppModule } from './app.module.js';
import { JobsService } from './modules/jobs/jobs.service.js';

await runWorker(AppModule, async (app, signal) => {
  const jobs = app.get(JobsService);
  while (!signal.aborted) {
    await jobs.processNext(signal);
  }
});
```

```sh
node dist/worker.js
```

- `signal` aborts on `SIGINT` or `SIGTERM`. Check it between jobs, and pass it to anything that
  takes an `AbortSignal` (`fetch`, timers, most database drivers) so waiting work stops too.
- When the function returns or stops, providers are closed in reverse order, as with
  `app.close()`.
- The exit code is 0 on success or shutdown, and 1 when startup or the function fails. A provider
  that fails to start is named, with its cause:

```text
Worker failed to start: Failed to create Database in DatabaseModule
  connect ECONNREFUSED 127.0.0.1:5432
```

For a one-off script, return when done:

```ts
await runWorker(AppModule, async (app) => {
  await app.get(UsersService).backfillEmails();
});
```

## Next

Coming from NestJS? See [Avi.js for NestJS developers](99-from-nestjs.md), or go back to the
[tutorial index](README.md).
