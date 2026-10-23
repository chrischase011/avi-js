// Uses the generated Api the way a frontend would; compiled by the generator test.
import { createClient } from '@avijs/client';
import type { Api } from './api.gen.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectType = <A, B>(_: Equal<A, B>) => undefined;

const api = createClient<Api>({ baseUrl: 'http://localhost:3000' });

export async function use() {
  const list = await api.get('/users', { query: { page: '1' } });
  expectType<typeof list, { id: number; name: string; page?: string }[]>(true);

  const one = await api.get('/users/:id', { params: { id: 1 } });
  expectType<typeof one, { id: number; joined: string }>(true);

  const created = await api.post('/users', { body: { name: 'Shiela' } });
  expectType<typeof created, { id: number; name: string }>(true);

  const item = await api.put('/api/items/:id', { params: { id: 'a' }, body: { name: 'b' } });
  expectType<typeof item, { id: string; name: string }>(true);

  const removed = await api.delete('/api/items/:id', { params: { id: 'a' } });
  expectType<typeof removed, undefined>(true);

  // @ts-expect-error not part of the Api: the controller is not exported
  await api.get('/api/hidden');
}
