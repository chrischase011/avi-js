// The API on every CPU core. WORKERS overrides the count, for example WORKERS=2.
import { AviFactory } from '@avijs/core';
import { cluster } from '@avijs/workers';
import { AppModule } from './app.js';

const workers = process.env['WORKERS'] ? Number(process.env['WORKERS']) : 'auto';

await cluster(
  async () => {
    const app = await AviFactory.create(AppModule);
    await app.listen(Number(process.env['PORT'] ?? 3000));
    return app;
  },
  { workers },
);
