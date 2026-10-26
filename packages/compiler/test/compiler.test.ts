import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { readProgram } from '../src/check.js';
import {
  buildProject,
  checkInjectLists,
  generateClient,
  main,
  serializeManifest,
  watchProject,
  writeManifest,
  type ProjectWatcher,
} from '../src/index.js';
import { createAvi, describeApp, type AviApp, type ModuleRef } from '@avijs/core';

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

describe('generateClient', { timeout: 60_000 }, () => {
  const client = path.join(fixtures, 'client');
  const generate = (dir: string) =>
    generateClient({
      project: path.join(dir, 'tsconfig.json'),
      out: path.join(dir, 'src/api.gen.ts'),
    });

  it('generates the committed Api for the fixture app', async () => {
    const result = generate(client);
    expect(result.source).toBe(await readFile(path.join(client, 'src/api.gen.ts'), 'utf8'));
  });

  it('explains every route it cannot reference', () => {
    const found = generate(client).diagnostics.map((d) => [path.basename(d.file), d.line, d.code]);
    expect(found).toEqual([
      ['items.module.ts', 5, 'AVI102'],
      ['items.module.ts', 15, 'AVI102'],
      ['items.module.ts', 17, 'AVI102'],
      ['users.controller.ts', 27, 'AVI105'],
    ]);
  });

  it('gives a frontend exact types (consumer.ts asserts them)', () => {
    const { program } = readProgram(path.join(client, 'tsconfig.json'));
    const errors = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(errors).toEqual([]);
  });

  // Loaded by URL so this test program does not type-check the examples.
  const example = async (name: string, file: string) =>
    (await import(new URL(`../../../examples/${name}/src/${file}`, import.meta.url).href)) as {
      AppModule?: ModuleRef;
      createApp?: (options?: object) => AviApp;
    };

  it.each([
    ['basic-api', async () => (await example('basic-api', 'app.ts')).createApp?.()],
    ['modular-api', async () => (await example('modular-api', 'app.module.ts')).AppModule],
    ['crud-api', async () => (await example('crud-api', 'app.module.ts')).AppModule],
    ['auth-api', async () => (await example('auth-api', 'app.ts')).createApp?.({ secret: 'test' })],
  ])('finds the same routes as the running %s', async (name, start) => {
    const dir = fileURLToPath(new URL(`../../../examples/${name}/`, import.meta.url));
    const result = generate(dir);
    expect(result.diagnostics).toEqual([]);

    const loaded = await start();
    if (!loaded) throw new Error(`Cannot load ${name}`);
    const app = 'listen' in loaded ? loaded : createAvi().register(loaded);
    await app.init();
    try {
      const running = app.routes().map((r) => `${r.method} ${r.path}`);
      expect(result.routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(running.sort());
    } finally {
      await app.close();
    }
  });
});

describe('avi-compile client', { timeout: 60_000 }, () => {
  const client = path.join(fixtures, 'client');
  const project = path.join(client, 'tsconfig.json');
  let dir: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('writes the file, then --check passes until routes change', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dir = await mkdtemp(path.join(tmpdir(), 'avi-client-'));
    const out = path.join(dir, 'api', 'api.gen.ts');

    expect(await main(['client', '--project', project, '--out', out])).toBe(0);
    expect(log).toHaveBeenCalledWith(`Wrote ${out}: 7 routes`);
    expect(await main(['client', '--project', project, '--out', out, '--check'])).toBe(0);

    // Reformatting is fine; a missing route is not.
    const source = await readFile(out, 'utf8');
    await writeFile(out, source.replaceAll(';', '').replaceAll('  ', '    '));
    expect(await main(['client', '--project', project, '--out', out, '--check'])).toBe(0);
    await writeFile(out, source.replace(/^.*'GET \/users'.*\n/m, ''));
    expect(await main(['client', '--project', project, '--out', out, '--check'])).toBe(1);
    expect(log).toHaveBeenLastCalledWith(`${out} is out of date: run avi client`);
  });
});

describe('generateClient with unusual route paths', () => {
  it('escapes paths into valid string literals and skips non-HTTP methods', () => {
    const dir = path.join(fixtures, 'client-quotes');
    const result = generateClient({
      project: path.join(dir, 'tsconfig.json'),
      out: path.join(dir, 'src/api.gen.ts'),
    });
    const file = ts.createSourceFile('api.gen.ts', result.source, ts.ScriptTarget.ES2023, true);
    // Only one top-level export: the Api interface. Nothing a path contains can add code.
    const statements = file.statements.filter((s) => !ts.isImportDeclaration(s));
    expect(statements).toHaveLength(1);
    const api = statements[0];
    expect(api && ts.isInterfaceDeclaration(api) && api.name.text).toBe('Api');
    const keys = (api as ts.InterfaceDeclaration).members.map((m) =>
      m.name && ts.isStringLiteral(m.name) ? m.name.text : '',
    );
    expect(keys.sort()).toEqual(
      [
        "GET /people/o'neil",
        'GET /people/a\b',
        "GET /x'; } export const pwned = 1; interface Z { 'q",
        'GET /line\nbreak',
      ].sort(),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('AVI107');
  });
});

describe('watchProject', { timeout: 60_000 }, () => {
  let dir: string | undefined;
  let watcher: ProjectWatcher | undefined;
  afterEach(async () => {
    watcher?.close();
    vi.restoreAllMocks();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('updates the client when a route is added, and only then', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // Inside fixtures/ so @avijs/core and valibot still resolve.
    dir = await mkdtemp(path.join(fixtures, '.watch-'));
    await cp(path.join(fixtures, 'client'), dir, { recursive: true });
    const out = path.join(dir, 'src/api.gen.ts');
    const controller = path.join(dir, 'src/users/users.controller.ts');

    const builds: (() => void)[] = [];
    const nextBuild = () => new Promise<void>((resolve) => builds.push(resolve));
    const first = nextBuild();
    watcher = watchProject({
      project: path.join(dir, 'tsconfig.json'),
      emit: false,
      client: { out },
      onBuild: () => builds.shift()?.(),
    });
    await first;
    // The copied file is current: nothing is written.
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('updated'));

    const rebuilt = nextBuild();
    const settled = rebuilt.then(nextBuild);
    const source = await readFile(controller, 'utf8');
    await writeFile(
      controller,
      source.replace(
        "  @Get('/:id')",
        "  @Get('/me')\n  me() {\n    return { id: 1 };\n  }\n\n  @Get('/:id')",
      ),
    );
    await rebuilt;
    expect(log).toHaveBeenCalledWith(`${out} updated: 8 routes`);
    expect(await readFile(out, 'utf8')).toContain("'GET /users/me'");

    // Writing the file triggers one more build, which finds it current: no loop.
    await settled;
    const updates = log.mock.calls.filter((call) => String(call[0]).includes('updated'));
    expect(updates).toHaveLength(1);
  });

  it('removes a deleted route without reporting the stale file as a type error', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    dir = await mkdtemp(path.join(fixtures, '.watch-'));
    await cp(path.join(fixtures, 'client'), dir, { recursive: true });
    const out = path.join(dir, 'src/api.gen.ts');
    const controller = path.join(dir, 'src/users/users.controller.ts');

    const errors: number[] = [];
    let built: (() => void) | undefined;
    const nextBuild = () => new Promise<void>((resolve) => (built = resolve));
    const first = nextBuild();
    watcher = watchProject({
      project: path.join(dir, 'tsconfig.json'),
      client: { out },
      onBuild: (count) => {
        errors.push(count);
        built?.();
      },
    });
    await first;

    const rebuilt = nextBuild();
    const source = await readFile(controller, 'utf8');
    // POST /users/import; the fixture's consumer.ts does not call it.
    await writeFile(
      controller,
      source.replace(/\n\n {2}\/\/ The schema is there[\s\S]*?\n {2}\}\n/, '\n'),
    );
    await rebuilt;
    expect(log).toHaveBeenCalledWith(`${out} updated: 6 routes`);
    expect(await readFile(out, 'utf8')).not.toContain('importMany');
    expect(errors).toEqual([0, 0]);
  });
});

describe('buildProject', () => {
  let dir: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const project = async (outDir: string, source: string, exclude?: string[]) => {
    dir = await mkdtemp(path.join(tmpdir(), 'avi-build-'));
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src/a.ts'), source);
    const compilerOptions = { outDir, rootDir: 'src', types: [], skipLibCheck: true };
    const tsconfig = { compilerOptions, include: ['src'], ...(exclude ? { exclude } : {}) };
    await writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig));
    return path.join(dir, 'tsconfig.json');
  };

  it('empties the output folder, so deleted sources do not linger', async () => {
    const config = await project('dist', 'export const a = 1;');
    const stale = path.join(path.dirname(config), 'dist/old.test.js');
    await mkdir(path.dirname(stale));
    await writeFile(stale, 'throw new Error("stale")');

    expect(buildProject({ project: config })).toBe(0);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(path.join(path.dirname(config), 'dist/a.js'))).toBe(true);
  });

  it('never empties an output folder that is the project or holds its sources', async () => {
    // With exclude set, tsc no longer leaves the output folder out of the sources.
    const config = await project('.', 'export const a = 1;', []);
    const keep = path.join(path.dirname(config), 'keep.txt');
    await writeFile(keep, 'mine');
    expect(buildProject({ project: config })).toBe(0);
    expect(existsSync(keep)).toBe(true);
  });

  it('reports type errors and counts them', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const config = await project('dist', "export const a: number = 'x';");
    expect(buildProject({ project: config })).toBe(1);
    expect(String(write.mock.calls[0]?.[0])).toContain('TS2322');
  });
});

describe('generateClient with a module built at runtime', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('names the call briefly, on one line', async () => {
    dir = await mkdtemp(path.join(fixtures, '.dynamic-'));
    await cp(path.join(fixtures, 'client/tsconfig.json'), path.join(dir, 'tsconfig.json'));
    await mkdir(path.join(dir, 'src'));
    await writeFile(
      path.join(dir, 'src/main.ts'),
      [
        "import { createAvi, defineModule } from '@avijs/core';",
        'const make = (options: { name: string }) => defineModule({ name: options.name });',
        'createAvi().register({',
        '  imports: [',
        '    make({',
        "      name: 'Dynamic',",
        '    }),',
        '  ],',
        '});',
      ].join('\n'),
    );
    const result = generateClient({
      project: path.join(dir, 'tsconfig.json'),
      out: path.join(dir, 'src/api.gen.ts'),
    });
    expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ['AVI104', 'Cannot read module make(...) statically; its routes are left out'],
    ]);
  });
});
