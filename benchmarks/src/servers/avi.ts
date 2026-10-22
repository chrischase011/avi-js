import { createAvi, defineController } from '@avi/core';
import { ROUTES } from '../routes.js';

const filler = ROUTES.filter(([, path]) => path !== '/' && path !== '/users/:id');

const app = createAvi().register({
  controllers: [
    defineController({
      routes: [
        { method: 'GET', path: '/', handler: () => ({ hello: 'world' }) },
        { method: 'GET', path: '/users/:id', handler: (ctx) => ({ id: ctx.params['id'] }) },
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
