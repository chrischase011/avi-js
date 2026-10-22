// Runs the decorator-based app from its tsc build output, then shuts down.
import assert from 'node:assert/strict';
import { AviFactory } from '@avijs/core';
import { AppModule } from './app.module.js';
import { UsersService } from './modules/users/users.service.js';

const app = await AviFactory.create(AppModule);
const { port } = await app.listen(0, '127.0.0.1');
const url = `http://127.0.0.1:${String(port)}`;

try {
  assert.equal(await (await fetch(`${url}/health`)).text(), 'ok');
  assert.deepEqual(await (await fetch(`${url}/users/1`)).json(), { id: 1, name: 'Ada' });

  const created = await fetch(`${url}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Grace' }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('location'), '/users/2');

  assert.equal((await fetch(`${url}/users/99`)).status, 404);
  assert.equal(app.get(UsersService).findAll().length, 2);
} finally {
  await app.close();
}

console.log('modular-api smoke check passed');
