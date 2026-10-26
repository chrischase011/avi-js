import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/worker-app.mjs', import.meta.url));

beforeAll(() => {
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  const build = spawnSync(
    process.execPath,
    [tsc, '-b', path.join(root, 'packages/workers/tsconfig.build.json')],
    { encoding: 'utf8' },
  );
  if (build.status !== 0) throw new Error(`Build failed:\n${build.stdout}${build.stderr}`);
}, 120_000);

/** Runs the fixture; `after` runs once it prints "working". */
function run(mode: string, after?: (send: (line: string) => void, kill: () => void) => void) {
  const child = spawn(process.execPath, [fixture], { env: { ...process.env, MODE: mode } });
  let out = '';
  let err = '';
  let started = false;
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
    if (!started && out.includes('working')) {
      started = true;
      after?.(
        (line) => child.stdin.write(`${line}\n`),
        () => child.kill('SIGTERM'),
      );
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8');
  });
  return new Promise<{ code: number | null; out: string[]; err: string }>((resolve) => {
    child.once('exit', (code) => {
      resolve({ code, out: out.split(/\r?\n/).filter(Boolean), err });
    });
  });
}

describe('runWorker', { timeout: 30_000 }, () => {
  it('stops the work on a signal, then closes providers in reverse order', async () => {
    const result = await run('loop', (send) => {
      setTimeout(() => {
        send('signal');
      }, 150);
    });
    expect(result.out).toEqual([
      'working',
      'stopped after some jobs',
      'closed Jobs',
      'closed Db',
      'exit code 0',
    ]);
    expect(result.code).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('handles a real SIGTERM', async () => {
    const result = await run('loop', (_send, kill) => {
      setTimeout(kill, 150);
    });
    expect(result.out.slice(-3)).toEqual(['closed Jobs', 'closed Db', 'exit code 0']);
    expect(result.code).toBe(0);
  });

  it('exits cleanly when the work returns', async () => {
    const result = await run('once');
    expect(result.out).toEqual(['working', 'closed Jobs', 'closed Db', 'exit code 0']);
    expect(result.code).toBe(0);
  });

  it('logs a failing job, still closes providers, and exits 1', async () => {
    const result = await run('throw');
    expect(result.err).toContain('Worker failed: job failed');
    expect(result.out).toEqual(['working', 'closed Jobs', 'closed Db', 'exit code 1']);
    expect(result.code).toBe(1);
  });

  it('names the provider that failed to start, with its cause', async () => {
    const result = await run('startfail');
    expect(result.err).toContain('Worker failed to start: Failed to create Db in AppModule');
    expect(result.err).toContain('ECONNREFUSED');
    expect(result.out).toEqual(['exit code 1']);
    expect(result.code).toBe(1);
  });
});
