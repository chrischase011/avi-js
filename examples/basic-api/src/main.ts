import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env['PORT'] ?? 3000);
const { address } = await app.listen(port);
console.log(`Listening on http://${address === '::' ? 'localhost' : address}:${String(port)}`);

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
