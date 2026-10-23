import { createToken, defineController, route } from '@avijs/core';
import * as v from 'valibot';

export interface Item {
  id: string;
  price: bigint;
  name: string;
}
const Store = createToken<{ get(id: string): Item }>('Store');

export const items = defineController({
  prefix: '/items',
  inject: [Store],
  routes: (store) => [
    route({ method: 'GET', path: '/:id', handler: (ctx) => store.get(ctx.params.id) }),
    route({
      method: 'PUT',
      path: '/:id',
      schema: { body: v.object({ name: v.string() }) },
      handler: (ctx) => ({ ...store.get(ctx.params.id), name: ctx.input.body.name }),
    }),
    { method: 'DELETE', path: '/:id', handler: () => undefined },
  ],
});
