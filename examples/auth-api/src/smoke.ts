// Signs in as each demo user and checks what each may see, then shuts down.
import assert from 'node:assert/strict';
import { createTestClient } from '@avijs/testing';
import { createApp } from './app.js';

const client = await createTestClient(createApp({ secret: 'test-secret' }));

async function login(username: string, password: string) {
  const res = await client.post('/auth/login', { username, password });
  return { status: res.status, token: (res.body as { token?: string }).token };
}
const as = (token: string | undefined) => ({
  headers: { authorization: `Bearer ${String(token)}` },
});

try {
  assert.equal((await login('ada', 'wrong')).status, 401);
  assert.equal((await login('nobody', 'x')).status, 401);
  assert.equal((await client.post('/auth/login', { username: 'ada' })).status, 400);

  const shiela = await login('shiela', 'my-love-forever');
  const ada = await login('ada', 'analytical-engine');
  const grace = await login('grace', 'cobol-forever');
  assert.equal(ada.status, 200);

  const me = await client.get('/me', as(grace.token));
  assert.deepEqual(me.body, { id: 3, username: 'grace', role: 'member' });
  assert.equal(me.headers.get('x-frame-options'), 'DENY');

  const anonymous = await client.get('/me');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('www-authenticate'), 'Bearer');
  assert.equal((await client.get('/me', as('forged.token'))).status, 401);

  assert.equal((await client.get('/admin/stats', as(grace.token))).status, 403);
  assert.deepEqual((await client.get('/admin/stats', as(ada.token))).body, { users: 3 });
  assert.equal((await client.get('/admin/stats', as(shiela.token))).status, 200);

  const preflight = await client.request('OPTIONS', '/me', {
    headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
} finally {
  await client.close();
}

console.log('auth-api smoke check passed');
