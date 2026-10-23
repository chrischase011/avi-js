// Exercises every route through the typed client, then shuts down.
import assert from 'node:assert/strict';
import { AviClientError, createClient } from '@avijs/client';
import { createTestClient } from '@avijs/testing';
import type { Api } from './api.gen.js';
import { AppModule } from './app.module.js';

const server = await createTestClient<Api>(AppModule);
// What a frontend would do; Api comes from `avi client`.
const api = createClient<Api>({ baseUrl: server.url });

try {
  const task = await api.post('/tasks', { body: { title: '  Write docs  ' } });
  assert.deepEqual(
    { ...task, createdAt: undefined },
    { id: 1, title: 'Write docs', status: 'todo', createdAt: undefined },
  );
  // The test client returns the status and headers too.
  const second = await server.api.post('/tasks', { body: { title: 'Ship', status: 'doing' } });
  assert.equal(second.status, 201);
  assert.equal(second.headers.get('location'), '/tasks/2');

  const doing = await api.get('/tasks', { query: { status: 'doing' } });
  assert.equal(doing.total, 1);
  const page = await api.get('/tasks', { query: { limit: '1', offset: '1' } });
  assert.deepEqual(
    page.items.map((t) => t.id),
    [2],
  );

  const updated = await api.patch('/tasks/:id', { params: { id: 1 }, body: { status: 'done' } });
  assert.equal(updated.status, 'done');

  await api.delete('/tasks/:id', { params: { id: 2 } });
  const missing = await api.get('/tasks/:id', { params: { id: 2 } }).catch((e: unknown) => e);
  assert.ok(missing instanceof AviClientError);
  assert.equal(missing.status, 404);

  // Invalid input on purpose, so the untyped calls.
  const invalid = await server.post('/tasks', { title: '', status: 'later' });
  assert.equal(invalid.status, 400);
  const issues = (invalid.body as { details: { issues: { path: string[] }[] } }).details.issues;
  assert.deepEqual(issues.map((issue) => issue.path[0]).sort(), ['status', 'title']);
  assert.equal((await server.patch('/tasks/1', {})).status, 400);
  assert.equal((await server.get('/tasks/abc')).status, 400);
} finally {
  await server.close();
}

console.log('crud-api smoke check passed');
