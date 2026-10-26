import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { get } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/cluster-app.mjs', import.meta.url));

beforeAll(() => {
  // The fixture runs in real processes, so it uses the built packages.
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  const build = spawnSync(
    process.execPath,
    [tsc, '-b', path.join(root, 'packages/workers/tsconfig.build.json')],
    { encoding: 'utf8' },
  );
  if (build.status !== 0) throw new Error(`Build failed:\n${build.stdout}${build.stderr}`);
}, 120_000);

interface App {
  child: ChildProcessWithoutNullStreams;
  out: string[];
  err: string[];
  /** Resolves with the first stdout line matching, waiting for it if needed. */
  line(pattern: RegExp, timeout?: number): Promise<RegExpExecArray>;
  send(command: string): void;
  exit: Promise<number | null>;
}

const running: App[] = [];
afterEach(() => {
  for (const app of running.splice(0)) app.child.kill();
});

function start(env: Record<string, string> = {}): App {
  const child = spawn(process.execPath, [fixture], {
    // Round-robin is the default except on Windows; force it so every OS tests the handoff path.
    env: { ...process.env, NODE_ENV: 'production', NODE_CLUSTER_SCHED_POLICY: 'rr', ...env },
  });
  const out: string[] = [];
  const err: string[] = [];
  const waiting = new Set<() => void>();
  const collect = (into: string[]) => (chunk: Buffer) => {
    into.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean));
    for (const check of waiting) check();
  };
  child.stdout.on('data', collect(out));
  child.stderr.on('data', collect(err));
  const exit = new Promise<number | null>((resolve) => child.once('exit', resolve));
  const app: App = {
    child,
    out,
    err,
    exit,
    send: (command) => child.stdin.write(`${command}\n`),
    line: (pattern, timeout = 20_000) =>
      new Promise((resolve, reject) => {
        const check = () => {
          for (const text of [...out, ...err]) {
            const match = pattern.exec(text);
            if (match) {
              waiting.delete(check);
              clearTimeout(timer);
              resolve(match);
              return;
            }
          }
        };
        const timer = setTimeout(() => {
          waiting.delete(check);
          reject(new Error(`No line matching ${String(pattern)}:\n${[...out, ...err].join('\n')}`));
        }, timeout);
        waiting.add(check);
        check();
      }),
  };
  running.push(app);
  return app;
}

/** GET on a fresh connection, so the OS or primary can pick any worker. */
function fetchText(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = get(url, { agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    // A request no worker answers must fail the test, not hang it.
    req.setTimeout(5_000, () => req.destroy(new Error(`No answer from ${url} within 5 s`)));
    req.on('error', reject);
  });
}

const pidOf = async (url: string) =>
  (JSON.parse((await fetchText(`${url}/pid`)).body) as { pid: number }).pid;

async function ready(app: App): Promise<string> {
  const [, workers, url] = await app.line(/cluster: (\d+) workers on (http:\/\/\S+), ready in/);
  expect(workers).toBe('2');
  return url ?? '';
}

describe('cluster', { timeout: 60_000 }, () => {
  it('runs the app in several workers on one port, with one summary line', async () => {
    const app = start();
    const url = await ready(app);
    const primary = Number((await app.line(/PRIMARY (\d+)/))[1]);

    const pids = new Set<number>();
    // Concurrent connections, so a second worker gets work even where the OS picks the worker.
    for (let batch = 0; batch < 5 && pids.size < 2; batch++) {
      const batchPids = await Promise.all(Array.from({ length: 50 }, () => pidOf(url)));
      for (const pid of batchPids) pids.add(pid);
    }
    expect(pids.size).toBe(2);
    expect(pids.has(primary)).toBe(false);
    expect(app.out.filter((l) => l.includes('cluster:'))).toHaveLength(1);
  });

  it('replaces a worker that crashes', async () => {
    const app = start();
    const url = await ready(app);
    await fetchText(`${url}/crash`);
    await app.line(/A worker exited unexpectedly \(code 3\); starting a new one/);
    app.send('count');
    // The replacement may still be starting; wait until both are back.
    for (let i = 0; i < 50; i++) {
      app.out.splice(0, app.out.length, ...app.out.filter((l) => !l.startsWith('COUNT')));
      app.send('count');
      if ((await app.line(/COUNT (\d+)/))[1] === '2') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect((await fetchText(`${url}/pid`)).status).toBe(200);
  });

  it('stops after too many crashes instead of restarting forever', async () => {
    const app = start({ MAX_RESTARTS: '1' });
    const url = await ready(app);
    await fetchText(`${url}/crash`).catch(() => undefined);
    await app.line(/starting a new one/);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fetchText(`${url}/crash`).catch(() => undefined);
    await app.line(/Workers keep crashing \(2 exits in 10000 ms, last code 3\); stopping/);
    expect(await app.exit).toBe(1);
  });

  it('lets in-flight requests finish on shutdown, then exits on its own', async () => {
    const app = start();
    const url = await ready(app);
    const slow = fetchText(`${url}/slow`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    app.send('close');
    expect(await slow).toEqual({ status: 200, body: 'done' });
    await app.line(/CLOSED/);
    expect(await app.exit).toBe(0);
  });

  it('restarts workers one at a time without dropping requests', async () => {
    const app = start();
    const url = await ready(app);
    const before = new Set<number>();
    for (let i = 0; i < 40 && before.size < 2; i++) before.add(await pidOf(url));

    app.send('restart');
    const state = { restarted: false };
    void app.line(/RESTARTED/).then(() => (state.restarted = true));
    const statuses: number[] = [];
    while (!state.restarted) statuses.push((await fetchText(`${url}/pid`)).status);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((s) => s === 200)).toBe(true);

    const after = new Set<number>();
    for (let i = 0; i < 40 && after.size < 2; i++) after.add(await pidOf(url));
    expect([...after].some((pid) => before.has(pid))).toBe(false);
  });

  it('ignores IPC messages that are not its own', async () => {
    const app = start();
    const url = await ready(app);
    expect((await fetchText(`${url}/odd-message`)).body).toBe('sent');
    await new Promise((resolve) => setTimeout(resolve, 200));
    app.send('count');
    expect((await app.line(/COUNT (\d+)/))[1]).toBe('2');
    expect(app.err.join('\n')).not.toMatch(/TypeError|exited unexpectedly/);
  });

  it('stops with exit code 1 when replacements cannot start, instead of running empty', async () => {
    const app = start({ FAIL_REPLACEMENTS: '1' });
    const url = await ready(app);
    for (let i = 0; i < 2; i++) await fetchText(`${url}/crash`).catch(() => undefined);
    await app.line(/no workers left|keep crashing/i);
    expect(await app.exit).toBe(1);
  });

  it('fails to start with the worker error and its cause', async () => {
    const app = start({ FAIL_START: '1' });
    await app.line(/cluster failed to start: Failed to create Database\s*$/);
    await app.line(/database unreachable/);
    expect(await app.exit).not.toBe(0);
  });

  it('runs in this process with one worker', async () => {
    const app = start({ WORKERS: '1', SUMMARY: '1' });
    const [, url] = await app.line(/listening on (http:\/\/\S+)/);
    const primary = Number((await app.line(/PRIMARY (\d+)/))[1]);
    expect(await pidOf(url ?? '')).toBe(primary);
  });
});
