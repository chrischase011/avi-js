// Hono on @hono/node-server with the same routes and responses as the Avi server.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { LIST, TOKEN } from '../data.js';
import { FILLER } from '../routes.js';

const app = new Hono();

app.get('/', (c) => c.json({ hello: 'world' }));
app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }));
app.get('/list', (c) => c.json(LIST));
app.post('/echo', async (c) => c.json(await c.req.json()));
app.post(
  '/orders',
  async (c, next) => {
    if (c.req.header('authorization') !== TOKEN) {
      return c.json({ statusCode: 403, error: 'Forbidden' }, 403);
    }
    await next();
    return undefined;
  },
  async (c) => {
    c.header('location', '/orders/1');
    return c.json({ id: 1, ...(await c.req.json<object>()) }, 201);
  },
);
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
