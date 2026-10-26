// A clustered app for the tests. Reads commands from stdin: restart, close, count.
import { createAvi, defineController, HttpError } from '@avijs/core';
import { cluster } from '@avijs/workers';
import nodeCluster from 'node:cluster';
import { createInterface } from 'node:readline';

const handle = await cluster(
  async () => {
    if (process.env.FAIL_START) {
      throw new Error('Failed to create Database', { cause: new Error('database unreachable') });
    }
    const app = createAvi({
      startupSummary: process.env.SUMMARY === '1',
      logger: { error: () => undefined },
    }).register({
      controllers: [
        defineController({
          routes: [
            { method: 'GET', path: '/pid', handler: () => ({ pid: process.pid }) },
            {
              method: 'GET',
              path: '/crash',
              handler: () => {
                setImmediate(() => process.exit(3));
                return 'bye';
              },
            },
            {
              method: 'GET',
              path: '/slow',
              handler: () => new Promise((resolve) => setTimeout(() => resolve('done'), 700)),
            },
            {
              method: 'GET',
              path: '/boom',
              handler: () => {
                throw new HttpError(418, 'no');
              },
            },
          ],
        }),
      ],
    });
    await app.listen(0, '127.0.0.1');
    return app;
  },
  {
    workers: Number(process.env.WORKERS ?? 2),
    shutdownTimeout: 5_000,
    maxRestarts: Number(process.env.MAX_RESTARTS ?? 5),
    restartWindow: 10_000,
    logger: { error: (m) => console.error(m), warn: (m) => console.error(m) },
  },
);

if (!nodeCluster.isWorker) {
  console.log(`PRIMARY ${process.pid}`);
  const input = createInterface({ input: process.stdin });
  input.on('line', (line) => {
    if (line === 'restart') void handle.restart().then(() => console.log('RESTARTED'));
    if (line === 'close') {
      void handle.close().then(() => {
        console.log('CLOSED');
        input.close();
      });
    }
    if (line === 'count') console.log(`COUNT ${String(handle.workers)}`);
  });
  // Stop reading stdin once the cluster stops, so the primary can exit.
  void handle.closed.then(() => input.close());
}
