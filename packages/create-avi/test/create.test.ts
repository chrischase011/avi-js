import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '../src/index.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'create-avi-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const name = async (project: string) =>
  (JSON.parse(await readFile(path.join(dir, project, 'package.json'), 'utf8')) as { name: string })
    .name;

describe('create', () => {
  it('creates a project from arguments without asking', async () => {
    const ask = vi.fn();
    expect(await create(['my-app', '--template', 'minimal', '--dir', dir], ask)).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    expect(await name('my-app')).toBe('my-app');
    expect(existsSync(path.join(dir, 'my-app/src/routes/users.ts'))).toBe(true);
  });

  it('asks for the name, template and validator when the name is missing', async () => {
    const ask = vi.fn((question: string, fallback: string) =>
      Promise.resolve(question.startsWith('Template') ? 'minimal' : fallback),
    );
    expect(await create(['--dir', dir], ask)).toBe(0);
    expect(ask.mock.calls.map(([question]) => question)).toEqual([
      'Project name',
      'Template, modular or minimal',
      'Validation library, valibot, zod or none',
    ]);
    expect(await name('my-avi-app')).toBe('my-avi-app');
    expect(existsSync(path.join(dir, 'my-avi-app/src/routes/users.ts'))).toBe(true);
  });

  it('only asks for what is missing', async () => {
    const ask = vi.fn(() => Promise.resolve('named'));
    const args = ['--template', 'modular', '--validator', 'zod', '--dir', dir];
    expect(await create(args, ask)).toBe(0);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(dir, 'named/package.json'), 'utf8')).toContain('"zod"');
    expect(existsSync(path.join(dir, 'named/src/app.module.ts'))).toBe(true);
  });

  it('fails without a name when it cannot ask', async () => {
    expect(await create(['--dir', dir], undefined)).toBe(2);
  });
});
