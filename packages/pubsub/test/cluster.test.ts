import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { get, request } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clusterAdapter } from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/cluster-app.mjs', import.meta.url));

beforeAll(() => {
  // The fixture runs in real processes, so it uses the built packages.
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  for (const pkg of ['pubsub', 'workers']) {
    const build = spawnSync(
      process.execPath,
      [tsc, '-b', path.join(root, `packages/${pkg}/tsconfig.build.json`)],
      { encoding: 'utf8' },
    );
    if (build.status !== 0) throw new Error(`Build failed:\n${build.stdout}${build.stderr}`);
  }
}, 120_000);

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

function waitFor<T>(what: string, check: () => T | undefined, output: () => string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const value = check();
      if (value !== undefined) {
        clearInterval(timer);
        clearTimeout(limit);
        resolve(value);
      }
    }, 20);
    const limit = setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`Timed out waiting for ${what}:\n${output()}`));
    }, 20_000);
  });
}

describe('clusterAdapter', { timeout: 60_000 }, () => {
  it('works in memory outside a cluster', () => {
    expect(typeof clusterAdapter().connect).toBe('function');
  });

  it('delivers a message published in one worker to subscribers in every worker', async () => {
    const child = spawn(process.execPath, [fixture], {
      env: { ...process.env, NODE_ENV: 'production', NODE_CLUSTER_SCHED_POLICY: 'rr' },
    });
    children.push(child);
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const url = await waitFor(
      'the cluster',
      () => /cluster: 2 workers on (http:\/\/\S+), ready in/.exec(output)?.[1],
      () => output,
    );

    // One worker streams; the ping reaches both, and each answers with its own pid.
    let stream = '';
    const live = get(`${url}/live`, { agent: false }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (stream += chunk));
    });
    live.on('error', () => undefined);
    await waitFor(
      'the stream to open',
      () => (stream.includes(': open') ? true : undefined),
      () => stream,
    );

    await new Promise<void>((resolve, reject) => {
      const req = request(`${url}/ping`, { method: 'POST', agent: false }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end();
    });
    const pids = await waitFor(
      'pongs from both workers',
      () => {
        const seen = new Set([...stream.matchAll(/"pid":(\d+)/g)].map((m) => m[1]));
        return seen.size === 2 ? seen : undefined;
      },
      () => `${stream}\n${output}`,
    );
    expect(pids.size).toBe(2);
    live.destroy();
  });
});
