import { AviFactory } from '@avi/core';
import { AppModule } from './app.module.js';

const app = await AviFactory.create(AppModule);
const port = Number(process.env['PORT'] ?? 3000);
await app.listen(port);
console.log(`Listening on http://localhost:${String(port)}`);

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
