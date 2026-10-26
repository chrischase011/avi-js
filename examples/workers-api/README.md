# Workers API example

An email API that runs on every CPU core, plus a background worker that sends the queued emails.

| Process         | File            | Does                                                          |
| --------------- | --------------- | ------------------------------------------------------------- |
| API (`cluster`) | `src/main.ts`   | `POST /emails` queues an email and answers `202` at once      |
| Worker          | `src/worker.ts` | Sends queued emails until stopped; `ONCE=1` empties and exits |

What it shows:

- **`cluster()`** from `@avijs/workers`: one API process per core on one port, crashed workers
  replaced, graceful shutdown on `SIGINT`/`SIGTERM`. `GET /pid` shows which worker answered.
- **`runWorker()`**: the worker uses the app's providers (`OutboxModule`) without an HTTP server,
  stops on a signal and closes its providers.
- **Shared work lives outside the processes.** Each process has its own memory, so the queue is a
  folder (`data/outbox/`). A real app would use a database table or a queue such as Redis.

```text
src/
├── main.ts      the API in a cluster
├── worker.ts    the background worker
├── app.ts       routes
├── outbox.ts    the file-based queue, as a module both processes import
└── smoke.ts     starts both and checks the queue empties
```

Run it from the repository root, in two terminals:

```sh
pnpm build
pnpm --filter @avijs/example-workers-api start    # API on every core, port 3000
pnpm --filter @avijs/example-workers-api worker   # sends queued emails
curl -X POST localhost:3000/emails -H 'content-type: application/json' -d '{"to":"shiela@example.com","subject":"Hi"}'
```

See the [workers chapter](../../docs/tutorial/16-workers.md) of the tutorial.
