// Starts the example from its build output, sends real requests, then shuts down.
import assert from 'node:assert/strict';
import { createApp } from './app.js';

const app = createApp();
const { port } = await app.listen(0, '127.0.0.1');
const url = `http://127.0.0.1:${String(port)}`;

try {
  const hello = await fetch(url);
  assert.equal(hello.status, 200);
  assert.deepEqual(await hello.json(), { message: 'Hello, Avi' });

  const created = await fetch(`${url}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Grace' }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('location'), '/users/2');

  const invalid = await fetch(`${url}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '[]',
  });
  assert.equal(invalid.status, 400);

  assert.equal((await fetch(`${url}/nope`)).status, 404);
} finally {
  await app.close();
}

console.log('basic-api smoke check passed');
