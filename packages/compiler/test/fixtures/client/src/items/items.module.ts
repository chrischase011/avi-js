import { defineController, defineModule, route } from '@avijs/core';
import * as v from 'valibot';
import { items } from './items.controller.js';

const hidden = defineController({ routes: [{ method: 'GET', path: '/hidden', handler: () => 1 }] });
const extra = [route({ method: 'GET', path: '/spread', handler: () => 1 })];

export const ItemsModule = defineModule({
  prefix: '/api',
  controllers: [
    items,
    // Not exported: AVI102.
    hidden,
    // Inline: AVI102.
    defineController({ routes: [{ method: 'GET', path: '/inline', handler: () => 1 }] }),
    // Spread routes: AVI103.
    defineController({ routes: [...extra] }),
  ],
});

export const Tag = v.object({ tag: v.string() });
