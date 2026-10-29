import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { readProgram } from '../src/check.js';
import { sameContent } from '../src/client.js';
import {
  buildProject,
  checkInjectLists,
  generateClient,
  generateInjects,
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

  it('refuses to overwrite a file it did not generate', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dir = await mkdtemp(path.join(tmpdir(), 'avi-client-'));
    const out = path.join(dir, 'main.ts');
    await writeFile(out, 'export const handWritten = true;\n');
    expect(await main(['client', '--project', project, '--out', out])).toBe(1);
    expect(await readFile(out, 'utf8')).toBe('export const handWritten = true;\n');
    expect(log).toHaveBeenLastCalledWith(
      `${out}: not written: the file exists and was not generated by avi`,
    );
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

  it('updates inject.gen.ts when a constructor changes', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dir = await mkdtemp(path.join(fixtures, '.watch-'));
    await cp(path.join(fixtures, 'inject'), dir, { recursive: true });
    const out = path.join(dir, 'src/inject.gen.ts');
    const builds: (() => void)[] = [];
    const nextBuild = () => new Promise<void>((resolve) => builds.push(resolve));
    const first = nextBuild();
    watcher = watchProject({
      project: path.join(dir, 'tsconfig.json'),
      emit: false,
      inject: { out },
      onBuild: () => builds.shift()?.(),
    });
    await first;
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('updated'));

    const rebuilt = nextBuild();
    const controller = path.join(dir, 'src/users/users.controller.ts');
    const source = await readFile(controller, 'utf8');
    await writeFile(
      controller,
      source.replace(
        'constructor(private readonly users: UsersService) {}',
        'constructor(\n    private readonly users: UsersService,\n    readonly clock: Clock,\n  ) {}',
      ),
    );
    await rebuilt;
    expect(log).toHaveBeenCalledWith(`${out} updated: 5 dependency lists`);
    expect(await readFile(out, 'utf8')).toContain('[UsersController, [UsersService, Clock]],');
  });

  it('still builds when the client file is outside the program', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    dir = await mkdtemp(path.join(fixtures, '.watch-'));
    await cp(path.join(fixtures, 'client'), dir, { recursive: true });
    const project = path.join(dir, 'tsconfig.json');
    // Not under the tsconfig's include, as a frontend's copy would be.
    const out = path.join(dir, 'web/api.gen.ts');
    const errors = await new Promise<number>((resolve) => {
      watcher = watchProject({ project, client: { out }, onBuild: resolve });
    });
    expect(errors).toBe(0);
    expect(existsSync(out)).toBe(true);
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
  const dirs: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  const project = async (outDir: string, source: string, exclude?: string[]) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'avi-build-'));
    dirs.push(dir);
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src/a.ts'), source);
    const compilerOptions = { outDir, rootDir: 'src', types: [], skipLibCheck: true };
    const tsconfig = { compilerOptions, include: ['src'], ...(exclude ? { exclude } : {}) };
    await writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig));
    return path.join(dir, 'tsconfig.json');
  };

  it('removes what an earlier build compiled from a source that is gone, and nothing else', async () => {
    const config = await project('dist', 'export const a = 1;');
    const root = path.dirname(config);
    await mkdir(path.join(root, 'src/old'));
    await writeFile(path.join(root, 'src/old/old.test.ts'), 'export const old = 1;');
    expect(buildProject({ project: config })).toBe(0);
    expect(existsSync(path.join(root, 'dist/old/old.test.js'))).toBe(true);

    // Files avi build did not write stay, compiled-looking or not.
    await writeFile(path.join(root, 'dist/handwritten.js'), '');
    await writeFile(path.join(root, 'dist/index.html'), '<html>');
    await rm(path.join(root, 'src/old'), { recursive: true });
    expect(buildProject({ project: config })).toBe(0);
    expect(existsSync(path.join(root, 'dist/old'))).toBe(false);
    expect(existsSync(path.join(root, 'dist/handwritten.js'))).toBe(true);
    expect(existsSync(path.join(root, 'dist/index.html'))).toBe(true);
    expect(existsSync(path.join(root, 'dist/a.js'))).toBe(true);
  });

  it('removes what avi dev compiled from a source deleted while it ran', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const config = await project('dist', 'export const a = 1;');
    const root = path.dirname(config);
    const ghost = path.join(root, 'src/ghost.test.ts');
    const builds: (() => void)[] = [];
    const nextBuild = () => new Promise<void>((resolve) => builds.push(resolve));
    const first = nextBuild();
    const watcher = watchProject({ project: config, onBuild: () => builds.shift()?.() });
    try {
      await first;
      const added = nextBuild();
      await writeFile(ghost, 'export const ghost = 1;');
      await added;
      expect(existsSync(path.join(root, 'dist/ghost.test.js'))).toBe(true);
    } finally {
      watcher.close();
    }
    await rm(ghost);
    expect(buildProject({ project: config })).toBe(0);
    expect(existsSync(path.join(root, 'dist/ghost.test.js'))).toBe(false);
    expect(existsSync(path.join(root, 'dist/a.js'))).toBe(true);
  });

  it('never cleans the project folder, a hidden folder or one reached through a link', async () => {
    // With exclude set, tsc no longer leaves the output folder out of the sources.
    const config = await project('.', 'export const a = 1;', []);
    const root = path.dirname(config);
    await writeFile(path.join(root, 'tool.js'), 'mine');
    buildProject({ project: config });
    buildProject({ project: config });
    expect(existsSync(path.join(root, 'tool.js'))).toBe(true);

    const hidden = await project('.git', 'export const a = 1;');
    await mkdir(path.join(path.dirname(hidden), '.git'));
    await writeFile(path.join(path.dirname(hidden), '.git/hook.js'), 'mine');
    buildProject({ project: hidden });
    buildProject({ project: hidden });
    expect(existsSync(path.join(path.dirname(hidden), '.git/hook.js'))).toBe(true);

    const outside = await mkdtemp(path.join(tmpdir(), 'avi-outside-'));
    try {
      await writeFile(path.join(outside, '.avi-build'), '');
      await writeFile(path.join(outside, 'precious.js'), 'mine');
      const linked = await project('link/out', 'export const a = 1;');
      await mkdir(path.join(outside, 'out'));
      await writeFile(path.join(outside, 'out/.avi-build'), '');
      await writeFile(path.join(outside, 'out/precious.js'), 'mine');
      await symlink(outside, path.join(path.dirname(linked), 'link'), 'junction');
      buildProject({ project: linked });
      expect(existsSync(path.join(outside, 'out/precious.js'))).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('cleans a project reached through a link above it, keeping fresh output', async () => {
    // Like macOS /var -> /private/var or a Windows short name: the link is outside the project.
    const config = await project('dist', 'export const a = 1;');
    const real = path.dirname(config);
    const linked = await mkdtemp(path.join(tmpdir(), 'avi-via-'));
    dirs.push(linked);
    await symlink(real, path.join(linked, 'p'), 'junction');
    const via = path.join(linked, 'p', 'tsconfig.json');

    await writeFile(path.join(real, 'src/gone.ts'), 'export const gone = 1;');
    expect(buildProject({ project: via })).toBe(0);
    expect(existsSync(path.join(real, 'dist/gone.js'))).toBe(true);
    await rm(path.join(real, 'src/gone.ts'));
    expect(buildProject({ project: via })).toBe(0);
    expect(existsSync(path.join(real, 'dist/gone.js'))).toBe(false);
    expect(existsSync(path.join(real, 'dist/a.js'))).toBe(true);
  });

  it('keeps output compiled from sources outside include, such as a sibling folder', async () => {
    dirs.push(await mkdtemp(path.join(tmpdir(), 'avi-sibling-')));
    const root = dirs.at(-1) as string;
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'shared'));
    await writeFile(path.join(root, 'shared/x.ts'), 'export const x = 1;');
    await writeFile(
      path.join(root, 'src/main.ts'),
      "import { x } from '../shared/x.js';\nexport const y = x;",
    );
    const compilerOptions = { outDir: 'dist', module: 'nodenext', types: [], skipLibCheck: true };
    await writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions, include: ['src'] }),
    );
    const config = path.join(root, 'tsconfig.json');
    expect(buildProject({ project: config })).toBe(0);
    expect(buildProject({ project: config })).toBe(0);
    expect(existsSync(path.join(root, 'dist/shared/x.js'))).toBe(true);
  });

  it('counts client generation errors, so a failed client fails the build', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const config = await project('dist', 'export const a = 1;');
    const out = path.join(path.dirname(config), 'src/api.gen.ts');
    expect(buildProject({ project: config, client: { out, root: 'src/a.ts#Nope' } })).toBe(1);
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

  it('names a local factory briefly, and stays quiet about library ones', async () => {
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
        '    // A library call, like OpenApiModule.forRoot: no app routes, no warning.',
        "    Object.freeze(defineModule({ name: 'Library' })),",
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

describe('generateInjects', { timeout: 60_000 }, () => {
  const dir = path.join(fixtures, 'inject');
  const generate = () =>
    generateInjects({
      project: path.join(dir, 'tsconfig.json'),
      out: path.join(dir, 'src/inject.gen.ts'),
    });

  it('infers classes, config tokens and library classes, and skips hand-written lists', async () => {
    const result = generate();
    expect(result.source).toBe(await readFile(path.join(dir, 'src/inject.gen.ts'), 'utf8'));
    // Explicit has static inject; Money takes a number and is not a DI class. Db is a constructor
    // and Mailer a token, each named like its type. The abstract Repo gets a list its subclass
    // inherits, WithOptional leaves its optional parameter out, and seed.ts, which the app never
    // imports, is not imported either.
    expect(result.classes).toEqual([
      'UsersRepo',
      'Repo',
      'WithOptional',
      'UsersController',
      'UsersService',
    ]);
    expect(result.source).not.toContain('seed');
    expect(result.source).toContain('[WithOptional, [Clock]],');
    // A function, so classes in an import cycle with the file exist when it runs.
    expect(result.source).toContain('registerInjects(() => [');
  });

  it('warns about classes it cannot complete, cannot import, or must not import', () => {
    const found = generate().diagnostics.map((d) => [d.code, d.message]);
    const runs = 'runs code when imported (an entry point or a script)';
    expect(found).toEqual([
      // User is a schema and Product a plain object, each named like its type: not tokens.
      [
        'AVI201',
        'Cannot infer what to inject for `user` of Profiles: only classes and tokens named like their type can be inferred; add static inject',
      ],
      [
        'AVI201',
        'Cannot infer what to inject for `product` of Catalog: only classes and tokens named like their type can be inferred; add static inject',
      ],
      // A seed script, a service worker and a worker entry run code when imported.
      [
        'AVI203',
        'Seeder is in a file that ' +
          runs +
          ', so inject.gen.ts cannot import it: move the class to its own file, or add static inject',
      ],
      [
        'AVI203',
        'Cache is in a file that ' +
          runs +
          ', so inject.gen.ts cannot import it: move the class to its own file, or add static inject',
      ],
      // A production install has no devDependencies.
      [
        'AVI203',
        'FakeMailer is in a file that imports @avijs/testing, a devDependency, so inject.gen.ts cannot import it: move the class to its own file, or add static inject',
      ],
      [
        'AVI201',
        'Cannot infer what to inject for `label` of Partial: only classes and tokens named like their type can be inferred; add static inject',
      ],
      ['AVI201', 'Export Hidden so its dependency list can be registered, or add static inject'],
      [
        'AVI203',
        'EmailJob is in a file that ' +
          runs +
          ', so inject.gen.ts cannot import it: move the class to its own file, or add static inject',
      ],
    ]);
  });

  it('checks the file with avi-compile inject --check', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const project = path.join(dir, 'tsconfig.json');
    const out = path.join(dir, 'src/inject.gen.ts');
    expect(await main(['inject', '--project', project, '--out', out, '--check'])).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('sameContent', () => {
  it('ignores formatting only, never content', () => {
    expect(
      sameContent(
        'registerInjects(() => [\n  [X, [A, B]],\n]);',
        'registerInjects(()=>[[X,[A,B]]])',
      ),
    ).toBe(true);
    expect(sameContent('[X, [A, B]]', '[X, [AB]]')).toBe(false);
    expect(sameContent("'./my dir/x.js'", "'./mydir/x.js'")).toBe(false);
    expect(sameContent('`a b`', '`ab`')).toBe(false);
    expect(sameContent('"a \\"b c\\" d"', '"a \\"bc\\" d"')).toBe(false);
    expect(sameContent("'a,]'", "'a]'")).toBe(false);
  });
});

describe('buildProject write errors', () => {
  let dir: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) {
      await chmod(path.join(dir, 'dist/a.js'), 0o644).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a file it cannot write like tsc, instead of crashing', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    dir = await mkdtemp(path.join(tmpdir(), 'avi-readonly-'));
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;');
    const compilerOptions = { outDir: 'dist', rootDir: 'src', types: [], skipLibCheck: true };
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions, include: ['src'] }),
    );
    const project = path.join(dir, 'tsconfig.json');
    expect(buildProject({ project })).toBe(0);
    await chmod(path.join(dir, 'dist/a.js'), 0o444);
    expect(buildProject({ project })).toBeGreaterThan(0);
    expect(write.mock.calls.map((call) => String(call[0])).join('')).toContain('TS5033');
  });
});
