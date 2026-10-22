import { createAvi, defineController, route } from '@avi/core';
import * as v from 'valibot';
import { ROUTES } from '../routes.js';

const filler = ROUTES.filter(([, path]) => path !== '/' && path !== '/users/:id');

const CreateUser = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  email: v.pipe(v.string(), v.email()),
  age: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

const app = createAvi().register({
  controllers: [
    defineController({
      routes: [
        { method: 'GET', path: '/', handler: () => ({ hello: 'world' }) },
        { method: 'GET', path: '/users/:id', handler: (ctx) => ({ id: ctx.params['id'] }) },
        { method: 'POST', path: '/echo', handler: (ctx) => ctx.json() },
        route({
          method: 'POST',
          path: '/validated',
          schema: { body: CreateUser },
          handler: (ctx) => ctx.input.body,
        }),
        ...filler.map(([method, path]) => ({ method, path, handler: () => null })),
      ],
    }),
  ],
});

const { port } = await app.listen(Number(process.argv[2] ?? 0), '127.0.0.1');
process.send?.({ port });
process.on('disconnect', () => {
  void app.close().then(() => process.exit(0));
});
