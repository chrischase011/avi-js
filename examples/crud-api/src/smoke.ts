// Exercises every route through the test client, then shuts down.
import assert from 'node:assert/strict';
import { createTestClient } from '@avijs/testing';
import { AppModule } from './app.module.js';

const client = await createTestClient(AppModule);

try {
  const created = await client.post('/tasks', { title: '  Write docs  ' });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('location'), '/tasks/1');
  assert.deepEqual(
    { ...(created.body as object), createdAt: undefined },
    { id: 1, title: 'Write docs', status: 'todo', createdAt: undefined },
  );
  await client.post('/tasks', { title: 'Ship', status: 'doing' });

  const doing = await client.get('/tasks', { query: { status: 'doing' } });
  assert.equal((doing.body as { total: number }).total, 1);
  const page = await client.get('/tasks', { query: { limit: '1', offset: '1' } });
  assert.deepEqual(
    (page.body as { items: { id: number }[] }).items.map((t) => t.id),
    [2],
  );

  const updated = await client.patch('/tasks/1', { status: 'done' });
  assert.equal((updated.body as { status: string }).status, 'done');

  assert.equal((await client.delete('/tasks/2')).status, 204);
  assert.equal((await client.get('/tasks/2')).status, 404);

  const invalid = await client.post('/tasks', { title: '', status: 'later' });
  assert.equal(invalid.status, 400);
  const issues = (invalid.body as { details: { issues: { path: string[] }[] } }).details.issues;
  assert.deepEqual(issues.map((issue) => issue.path[0]).sort(), ['status', 'title']);
  assert.equal((await client.patch('/tasks/1', {})).status, 400);
  assert.equal((await client.get('/tasks/abc')).status, 400);
} finally {
  await client.close();
}

console.log('crud-api smoke check passed');
