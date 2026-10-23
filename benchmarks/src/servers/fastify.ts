// Fastify with the same routes and responses as the Avi server.
import Fastify from 'fastify';
import type { AddressInfo } from 'node:net';
import { LIST, TOKEN } from '../data.js';
import { FILLER } from '../routes.js';

const app = Fastify({ logger: false });

app.get('/', () => ({ hello: 'world' }));
app.get<{ Params: { id: string } }>('/users/:id', (req) => ({ id: req.params.id }));
app.get('/list', () => LIST);
app.post('/echo', (req) => req.body);
app.post(
  '/orders',
  {
    preHandler: (req, reply, done) => {
      if (req.headers.authorization === TOKEN) {
        done();
        return;
      }
      void reply.code(403).send({ statusCode: 403, error: 'Forbidden' });
    },
  },
  (req, reply) => {
    void reply.code(201).header('location', '/orders/1');
    return { id: 1, ...(req.body as object) };
  },
);
for (const [method, path] of FILLER) app.route({ method, url: path, handler: () => null });

await app.listen({ port: Number(process.argv[2] ?? 0), host: '127.0.0.1' });
process.send?.({ port: (app.server.address() as AddressInfo).port });
process.on('disconnect', () => {
  void app.close().then(() => process.exit(0));
});
