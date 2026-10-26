# @avijs/workers

Run an Avi.js app on every CPU core, and background workers that use the app's providers.

```sh
npm install @avijs/workers
```

```ts
import { cluster, runWorker } from '@avijs/workers';

// One worker process per CPU core, all on port 3000. Crashed workers are replaced; SIGTERM
// closes them gracefully; SIGHUP (or handle.restart()) restarts them one at a time.
await cluster(async () => {
  const app = await AviFactory.create(AppModule);
  await app.listen(3000);
  return app;
});

// A background worker: the app's providers, no HTTP server, a signal for shutdown.
await runWorker(AppModule, async (app, signal) => {
  const jobs = app.get(JobsService);
  while (!signal.aborted) await jobs.processNext(signal);
});
```

Part of [Avi.js](https://github.com/chrischase011/avi-js). See the
[workers chapter](https://chrischase011.github.io/avi-js/tutorial/16-workers) of the tutorial.
Requires Node.js 22.12 or newer. MIT licensed.
