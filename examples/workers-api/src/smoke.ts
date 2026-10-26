// Starts the API on 2 workers, queues emails, runs the worker once, and checks the outbox empties.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = await mkdtemp(path.join(tmpdir(), 'avi-outbox-'));
const env = { ...process.env, OUTBOX_DIR: dir, NODE_ENV: 'production' };
const here = path.dirname(fileURLToPath(import.meta.url));

const api = spawn(process.execPath, [path.join(here, 'main.js')], {
  env: { ...env, WORKERS: '2', PORT: '0' },
});
let out = '';
const base = await new Promise<string>((resolve, reject) => {
  api.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
    const match = /cluster: 2 workers on (http:\/\/\S+),/.exec(out);
    if (match?.[1]) resolve(match[1]);
  });
  api.once('exit', (code) => {
    reject(new Error(`API exited with ${String(code)}:\n${out}`));
  });
});

function call(
  method: string,
  url: string,
  body?: string,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method, agent: false, headers: { 'content-type': 'application/json' } },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as unknown });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

try {
  const pids = new Set<number>();
  for (let batch = 0; batch < 5 && pids.size < 2; batch++) {
    const answers = await Promise.all(Array.from({ length: 30 }, () => call('GET', `${base}/pid`)));
    for (const { json } of answers) pids.add((json as { pid: number }).pid);
  }
  assert.equal(pids.size, 2, 'both workers answer');

  for (const to of ['shiela@example.com', 'ada@example.com', 'grace@example.com']) {
    const res = await call('POST', `${base}/emails`, JSON.stringify({ to, subject: 'Welcome' }));
    assert.equal(res.status, 202);
  }
  assert.deepEqual((await call('GET', `${base}/emails/pending`)).json, { count: 3 });

  const worker = spawn(process.execPath, [path.join(here, 'worker.js')], {
    env: { ...env, ONCE: '1' },
  });
  let sent = '';
  worker.stdout.on('data', (chunk: Buffer) => (sent += chunk.toString('utf8')));
  assert.equal(await new Promise((resolve) => worker.once('exit', resolve)), 0);
  assert.equal(sent.trim().split('\n').length, 3);
  assert.deepEqual((await call('GET', `${base}/emails/pending`)).json, { count: 0 });
} finally {
  api.kill();
  await rm(dir, { recursive: true, force: true });
}

console.log('workers-api smoke check passed');
