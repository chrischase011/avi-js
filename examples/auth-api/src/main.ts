import { createApp } from './app.js';

const secret = process.env['AUTH_SECRET'];
if (!secret) console.warn('AUTH_SECRET is not set: using a random secret for this run.');

const app = createApp({ secret, origin: process.env['CORS_ORIGIN'] });
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
