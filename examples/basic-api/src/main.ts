import { createApp } from './app.js';

const app = createApp();
await app.listen(Number(process.env['PORT'] ?? 3000));

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
