import { AviFactory } from '@avijs/core';
import { AppModule } from './app.module.js';

const app = await AviFactory.create(AppModule);
await app.listen(Number(process.env['PORT'] ?? 3000));

const shutdown = () => {
  app.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
