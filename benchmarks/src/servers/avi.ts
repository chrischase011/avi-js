// The Avi.js server. argv[3] = 'defaults' keeps request ids on (the default); otherwise they are
// off, so it does the same work as the other servers.
import { createAvi, defineController, reply, route, type Guard } from '@avijs/core';
import * as v from 'valibot';
import { LIST, TOKEN } from '../data.js';
import { FILLER } from '../routes.js';

const CreateUser = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  email: v.pipe(v.string(), v.email()),
  age: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

const authorized: Guard = (ctx) => ctx.headers.authorization === TOKEN;

const app = createAvi({
  startupSummary: false,
  ...(process.argv[3] === 'defaults' ? {} : { requestId: false }),
}).register({
  controllers: [
    defineController({
      routes: [
        { method: 'GET', path: '/', handler: () => ({ hello: 'world' }) },
        { method: 'GET', path: '/users/:id', handler: (ctx) => ({ id: ctx.params['id'] }) },
        { method: 'GET', path: '/list', handler: () => LIST },
        { method: 'POST', path: '/echo', handler: (ctx) => ctx.json() },
        {
          method: 'POST',
          path: '/orders',
          guards: [authorized],
          handler: async (ctx) =>
            reply(
              { id: 1, ...((await ctx.json()) as object) },
              { status: 201, headers: { location: '/orders/1' } },
            ),
        },
        route({
          method: 'POST',
          path: '/validated',
          schema: { body: CreateUser },
          handler: (ctx) => ctx.input.body,
        }),
        ...FILLER.map(([method, path]) => ({ method, path, handler: () => null })),
      ],
    }),
  ],
});

const { port } = await app.listen(Number(process.argv[2] ?? 0), '127.0.0.1');
process.send?.({ port });
process.on('disconnect', () => {
  void app.close().then(() => process.exit(0));
});
