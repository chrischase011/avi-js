// Generates each template, compiles it, runs its tests and starts it, against the local packages.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { main, templateFiles } from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
let workdir: string;

beforeAll(async () => {
  // Generated projects use the built packages, like an installed app would.
  const build = spawnSync(process.execPath, [tsc, '-b', path.join(root, 'tsconfig.json')], {
    encoding: 'utf8',
  });
  if (build.status !== 0) throw new Error(`Build failed:\n${build.stdout}${build.stderr}`);
  workdir = await mkdtemp(path.join(tmpdir(), 'avi-new-'));
}, 120_000);

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

async function linkPackages(project: string): Promise<void> {
  const links: [string, string][] = [
    ['@avijs/core', 'packages/core'],
    ['@avijs/testing', 'packages/testing'],
    ['@types/node', 'node_modules/@types/node'],
  ];
  for (const [name, target] of links) {
    const at = path.join(project, 'node_modules', name);
    await mkdir(path.dirname(at), { recursive: true });
    await symlink(path.join(root, target), at, 'junction');
  }
}

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

async function startAndGet(
  project: string,
  urlPath: string,
): Promise<{ status: number; body: string }> {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: project,
    env: { ...process.env, PORT: '0' },
  });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        const match = /Listening on (http:\/\/\S+)/.exec(output);
        if (match?.[1]) resolve(match[1]);
      });
      child.once('exit', (code) => {
        reject(new Error(`App exited with ${String(code)}: ${output}`));
      });
    });
    const res = await fetch(`${base}${urlPath}`);
    return { status: res.status, body: await res.text() };
  } finally {
    child.kill();
  }
}

describe.each(['modular', 'minimal'] as const)('avi new --template %s', (template) => {
  let project: string;

  beforeAll(async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await main(['new', `demo-${template}`, '--template', template, '--dir', workdir]);
    log.mockRestore();
    expect(code).toBe(0);
    project = path.join(workdir, `demo-${template}`);
    await linkPackages(project);
  });

  it('writes the documented layout', async () => {
    const files = Object.keys(templateFiles({ name: 'x', template, aviVersion: 'latest' }));
    expect(files).toEqual(
      expect.arrayContaining(
        template === 'modular'
          ? [
              'src/main.ts',
              'src/app.module.ts',
              'src/modules/users/users.module.ts',
              'src/common/health.controller.ts',
            ]
          : ['src/main.ts', 'src/routes/users.ts', 'src/services/users.ts'],
      ),
    );
    const pkg = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe(`demo-${template}`);
    const cli = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(pkg.dependencies['@avijs/core']).toBe(`^${cli.version}`);
  });

  it('compiles', () => {
    const result = run([tsc, '-p', 'tsconfig.json'], project);
    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  }, 60_000);

  it('passes its own tests', () => {
    const result = run(['--test', 'dist/**/*.test.js'], project);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/pass 3/);
  }, 60_000);

  it('serves requests', async () => {
    expect(await startAndGet(project, '/health')).toEqual({ status: 200, body: 'ok' });
    expect(await startAndGet(project, '/users/1')).toEqual({
      status: 200,
      body: '{"id":1,"name":"Ada"}',
    });
  }, 60_000);

  it('passes avi check', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await main(['check', '--project', path.join(project, 'tsconfig.json')]);
    log.mockRestore();
    expect(code).toBe(0);
  }, 60_000);
});

describe('avi', () => {
  it('refuses to overwrite a non-empty folder', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await main(['new', 'twice', '--dir', workdir]);
    expect(await main(['new', 'twice', '--dir', workdir])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    error.mockRestore();
  });

  it.each([
    [['new'], 'needs a project name'],
    [['new', 'Bad Name'], 'needs a project name'],
    [['new', 'ok', '--template', 'huge'], 'Unknown template'],
  ])('rejects %j', async (args, message) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(args)).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(message));
    error.mockRestore();
  });

  it('prints the dev commands with --dry-run', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(await main(['dev', '--dry-run'])).toBe(0);
    } finally {
      process.chdir(cwd);
    }
    const lines = log.mock.calls.map((call) => String(call[0]));
    log.mockRestore();
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('--watch');
    expect(lines[2]).toBe('node --watch --watch-preserve-output dist/main.js');
  });

  it('prints usage', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['help'])).toBe(0);
    expect(await main(['unknown'])).toBe(2);
    error.mockRestore();
  });
});
