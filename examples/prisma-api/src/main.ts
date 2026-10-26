import { AviFactory } from '@avijs/core';
import { AppModule } from './app.module.js';

const app = await AviFactory.create(AppModule);
await app.listen(Number(process.env['PORT'] ?? 3000));

// close() waits for in-flight requests, then disconnects Prisma.
const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
