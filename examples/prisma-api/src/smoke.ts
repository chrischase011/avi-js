// Runs every route against the database in DATABASE_URL (migrate it first), then shuts down.
import assert from 'node:assert/strict';
import { createTestClient } from '@avijs/testing';
import { AppModule } from './app.module.js';

const client = await createTestClient(AppModule);
const email = `shiela-${String(Date.now())}@example.com`;

try {
  const shiela = await client.post('/users', { email: ` ${email.toUpperCase()} `, name: 'Shiela' });
  assert.equal(shiela.status, 201);
  const user = shiela.body as { id: number; email: string };
  assert.equal(user.email, email);
  assert.equal((await client.post('/users', { email, name: 'Again' })).status, 409);

  const post = await client.post('/posts', { authorId: user.id, title: 'Notes on the Engine' });
  assert.equal(post.status, 201);
  const { id } = post.body as { id: number };
  assert.equal((await client.post('/posts', { authorId: 999_999, title: 'x' })).status, 404);

  const drafts = (await client.get('/posts', { query: { published: 'false' } })).body as {
    id: number;
  }[];
  assert.ok(drafts.some((p) => p.id === id));
  assert.equal(
    ((await client.patch(`/posts/${String(id)}/publish`)).body as { published: boolean }).published,
    true,
  );

  const withPosts = (await client.get(`/users/${String(user.id)}`)).body as { posts: unknown[] };
  assert.equal(withPosts.posts.length, 1);

  assert.equal((await client.delete(`/posts/${String(id)}`)).status, 204);
  assert.equal((await client.delete(`/posts/${String(id)}`)).status, 404);
  assert.equal((await client.get('/users/abc')).status, 400);
} finally {
  await client.close();
}

console.log('prisma-api smoke check passed');
