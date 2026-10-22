// Hono on @hono/node-server with the same routes and responses as the Avi server.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { FILLER } from '../routes.js';

const app = new Hono();

app.get('/', (c) => c.json({ hello: 'world' }));
app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }));
app.post('/echo', async (c) => c.json(await c.req.json()));
for (const [method, path] of FILLER) app.on(method, path, (c) => c.json(null));

const server = serve(
  { fetch: app.fetch, port: Number(process.argv[2] ?? 0), hostname: '127.0.0.1' },
  (info) => {
    process.send?.({ port: info.port });
  },
);
process.on('disconnect', () => {
  server.close(() => process.exit(0));
});
