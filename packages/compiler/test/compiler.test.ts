import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkInjectLists, main, serializeManifest, writeManifest } from '../src/index.js';
import { describeApp } from '@avijs/core';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const project = path.join(fixtures, 'tsconfig.json');

describe('checkInjectLists', () => {
  const diagnostics = checkInjectLists(project);
  const forClass = (name: string) => diagnostics.filter((d) => d.message.includes(name));

  it('accepts matching lists, subtypes and optional parameters', () => {
    expect(forClass('Good')).toEqual([]);
    expect(forClass('Subtype')).toEqual([]);
    expect(forClass('Optional')).toEqual([]);
    expect(forClass('NotDi')).toEqual([]);
  });

  it('reports a swapped order with file, line and both types', () => {
    const swapped = forClass('Swapped');
    expect(swapped.map((d) => d.code)).toEqual(['AVI004', 'AVI004']);
    expect(swapped[0]).toMatchObject({
      severity: 'error',
      file: expect.stringMatching(/inject\.ts$/) as unknown,
      message: 'Swapped.inject[0] provides Config, but parameter "db" expects Db',
    });
    expect(swapped[0]?.line).toBeGreaterThan(1);
  });

  it('reports a list shorter than the required parameters', () => {
    expect(forClass('Short')).toEqual([
      expect.objectContaining({
        code: 'AVI001',
        message: 'Short needs 2 constructor arguments but inject lists 1',
      }),
    ]);
  });

  it('resolves typed tokens to their value type', () => {
    expect(forClass('WrongToken')).toEqual([
      expect.objectContaining({
        code: 'AVI004',
        message: 'WrongToken.inject[0] provides number, but parameter "name" expects string',
      }),
    ]);
  });

  it('matches generic constructors against their own class', () => {
    expect(forClass('PrismaLike')).toEqual([]);
    expect(forClass('GenericMismatch')).toEqual([
      expect.objectContaining({
        code: 'AVI004',
        message: 'GenericMismatch.inject[0] provides Client<T>, but parameter "db" expects Db',
      }),
    ]);
  });

  it('resolves config tokens to their schema output', () => {
    expect(forClass('UsesSettings')).toEqual([]);
    expect(forClass('WrongSettings')).toEqual([
      expect.objectContaining({
        code: 'AVI004',
        message:
          'WrongSettings.inject[0] provides { port: number; }, but parameter "port" expects string',
      }),
    ]);
  });

  it('warns about lists it cannot check', () => {
    expect(forClass('Dynamic')).toEqual([
      expect.objectContaining({ code: 'AVI002', severity: 'warning' }),
    ]);
  });

  it('is deterministic', () => {
    expect(checkInjectLists(project)).toEqual(diagnostics);
  });
});

describe('manifests', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('describes modules, static routes and dynamic controllers', async () => {
    const { AppModule } = await import('./fixtures/app.js');
    const description = describeApp(AppModule);

    expect(description.routes).toEqual([
      { method: 'GET', path: '/api/health', module: 'AppModule', controller: 'Health' },
      { method: 'GET', path: '/api/items/:id', module: 'AppModule', controller: 'Items' },
    ]);
    expect(description.dynamic).toEqual(['AppModule / Late']);
    expect(description.modules.map((m) => m.name)).toEqual(['Shared', 'AppModule']);
  });

  it('serializes identically every time', async () => {
    const { AppModule } = await import('./fixtures/app.js');
    expect(serializeManifest(describeApp(AppModule))).toBe(
      serializeManifest(describeApp(AppModule)),
    );
  });

  it('writes a manifest from an entry module', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'avi-manifest-'));
    const out = path.join(dir, 'avi.manifest.json');
    await writeManifest({ entry: path.join(fixtures, 'app.ts'), out });
    const written = JSON.parse(await readFile(out, 'utf8')) as { routes: unknown[] };
    expect(written.routes).toHaveLength(2);
  });

  it('fails clearly when the export is missing', async () => {
    await expect(
      writeManifest({ entry: path.join(fixtures, 'app.ts'), exportName: 'Nope', out: 'x.json' }),
    ).rejects.toThrow('has no export named Nope');
  });
});

describe('cli', () => {
  it('exits 1 when inject lists have errors', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main(['check', '--project', project])).toBe(1);
    expect(log).toHaveBeenLastCalledWith('6 error(s), 1 warning(s) in static inject lists');
    log.mockRestore();
  });

  it('prints usage for unknown commands', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main([])).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    error.mockRestore();
  });
});
