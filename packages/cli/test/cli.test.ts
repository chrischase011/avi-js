// Generates each template, compiles it, runs its tests and starts it, against the local packages.
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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
    // Generated projects import their validator; the CLI has both as dev dependencies.
    ['valibot', 'packages/cli/node_modules/valibot'],
    ['zod', 'packages/cli/node_modules/zod'],
  ];
  for (const [name, target] of links) {
    const at = path.join(project, 'node_modules', name);
    await mkdir(path.dirname(at), { recursive: true });
    await symlink(await realpath(path.join(root, target)), at, 'junction');
  }
}

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

/** Starts the compiled app, runs `use` against its URL, then stops it. */
async function withApp<T>(project: string, use: (base: string) => Promise<T>): Promise<T> {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: project,
    // NODE_ENV=test would turn the startup summary off, and the URL is read from it.
    env: { ...process.env, PORT: '0', NODE_ENV: 'development' },
  });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        const match = /listening on (http:\/\/\S+)/.exec(output);
        if (match?.[1]) resolve(match[1]);
      });
      child.once('exit', (code) => {
        reject(new Error(`App exited with ${String(code)}: ${output}`));
      });
    });
    return await use(base);
  } finally {
    child.kill();
  }
}

function startAndGet(project: string, urlPath: string): Promise<{ status: number; body: string }> {
  return withApp(project, async (base) => {
    const res = await fetch(`${base}${urlPath}`);
    return { status: res.status, body: await res.text() };
  });
}

const TEMPLATES = ['modular', 'minimal'] as const;
const VALIDATORS = ['valibot', 'zod', 'none'] as const;

describe.each(TEMPLATES.flatMap((t) => VALIDATORS.map((v) => [t, v] as const)))(
  'avi new --template %s --validator %s',
  (template, validator) => {
    let project: string;
    const name = `demo-${template}-${validator}`;

    beforeAll(async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await main([
        'new',
        name,
        '--template',
        template,
        '--validator',
        validator,
        '--dir',
        workdir,
      ]);
      log.mockRestore();
      expect(code).toBe(0);
      project = path.join(workdir, name);
      await linkPackages(project);
    });

    it('writes the documented layout', async () => {
      const files = Object.keys(
        templateFiles({ name: 'x', template, validator, aviVersion: 'latest' }),
      );
      expect(files).toEqual(
        expect.arrayContaining(
          template === 'modular'
            ? [
                'src/main.ts',
                'src/app.module.ts',
                'src/modules/users/users.module.ts',
                'src/common/health.controller.ts',
                validator === 'none'
                  ? 'src/modules/users/dto/create-user.dto.ts'
                  : 'src/modules/users/dto/user.dto.ts',
              ]
            : ['src/main.ts', 'src/routes/users.ts', 'src/services/users.ts'],
        ),
      );
      const pkg = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')) as {
        name: string;
        dependencies: Record<string, string>;
      };
      expect(pkg.name).toBe(name);
      if (validator === 'none') expect(Object.keys(pkg.dependencies)).toEqual(['@avijs/core']);
      else expect(pkg.dependencies[validator]).toMatch(/^\^\d/);
      const cli = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8'),
      ) as {
        version: string;
      };
      expect(pkg.dependencies['@avijs/core']).toBe(`^${cli.version}`);
    });

    it('compiles', () => {
      const result = run([tsc, '-p', 'tsconfig.json'], project);
      expect(result.stdout + result.stderr).toBe('');
      expect(result.status).toBe(0);
    }, 60_000);

    it('builds with avi build, dropping compiled files whose source is gone', async () => {
      const source = path.join(project, 'src/old.test.ts');
      const compiled = path.join(project, 'dist/old.test.js');
      const build = () => main(['build', '--project', path.join(project, 'tsconfig.json')]);
      await writeFile(source, 'export const old = 1;\n');
      expect(await build()).toBe(0);
      expect(existsSync(compiled)).toBe(true);
      await rm(source);
      expect(await build()).toBe(0);
      expect(existsSync(compiled)).toBe(false);
      expect(existsSync(path.join(project, 'dist/main.js'))).toBe(true);
    }, 60_000);

    it('types a Vite frontend through dist/api.gen.d.ts', async () => {
      // Vite's react-ts settings: server source would fail them (parameter properties, Node types).
      const web = path.join(project, 'web');
      await mkdir(path.join(web, 'src'), { recursive: true });
      await mkdir(path.join(web, 'node_modules/@avijs'), { recursive: true });
      await symlink(
        await realpath(path.join(root, 'packages/client')),
        path.join(web, 'node_modules/@avijs/client'),
        'junction',
      );
      const tsconfig = {
        compilerOptions: {
          target: 'es2023',
          lib: ['ES2023', 'DOM'],
          module: 'esnext',
          moduleResolution: 'bundler',
          types: [],
          skipLibCheck: true,
          verbatimModuleSyntax: true,
          moduleDetection: 'force',
          noEmit: true,
          strict: true,
          noUnusedLocals: true,
          erasableSyntaxOnly: true,
        },
        include: ['src'],
      };
      await writeFile(path.join(web, 'tsconfig.json'), JSON.stringify(tsconfig));
      await writeFile(
        path.join(web, 'src/api.ts'),
        [
          "import { createClient } from '@avijs/client';",
          "import type { Api } from '../../dist/api.gen.js';",
          "const api = createClient<Api>({ baseUrl: 'http://localhost:3000' });",
          'export async function name(): Promise<string> {',
          "  const user = await api.get('/users/:id', { params: { id: 1 } });",
          '  return user.name;',
          '}',
          'export async function typed(): Promise<void> {',
          "  const user = await api.get('/users/:id', { params: { id: 1 } });",
          '  // @ts-expect-error name is a string: the response type must survive without Node types',
          '  const wrong: number = user.name;',
          '  void wrong;',
          '}',
          ...(validator === 'none'
            ? []
            : [
                '// @ts-expect-error a user needs a name',
                "void api.post('/users', { body: {} });",
              ]),
        ].join('\n'),
      );
      const result = run([tsc, '-p', 'web/tsconfig.json'], project);
      expect(result.stdout + result.stderr).toBe('');
      expect(result.status).toBe(0);
    }, 60_000);

    it('passes its own tests', () => {
      const result = run(['--test', 'dist/**/*.test.js'], project);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      // The minimal template adds a validation test when it has schemas.
      const tests = template === 'minimal' && validator !== 'none' ? 4 : 3;
      expect(result.stdout).toMatch(new RegExp(`pass ${String(tests)}`));
    }, 60_000);

    it('serves requests', async () => {
      expect(await startAndGet(project, '/health')).toEqual({ status: 200, body: 'ok' });
      expect(await startAndGet(project, '/users/1')).toEqual({
        status: 200,
        body: '{"id":1,"name":"Shiela"}',
      });
    }, 60_000);

    it('passes avi check', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await main(['check', '--project', path.join(project, 'tsconfig.json')]);
      log.mockRestore();
      expect(code).toBe(0);
    }, 60_000);

    it('ships the Api that avi client generates', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await main([
        'client',
        '--project',
        path.join(project, 'tsconfig.json'),
        '--out',
        path.join(project, 'src/api.gen.ts'),
        '--check',
      ]);
      log.mockRestore();
      expect(code).toBe(0);
    }, 60_000);

    it.runIf(template === 'modular')(
      'regenerates inject.gen.ts in avi build',
      async () => {
        const file = path.join(project, 'src/inject.gen.ts');
        const shipped = await readFile(file, 'utf8');
        const header = shipped.split('\n').slice(0, 3).join('\n');
        await writeFile(file, `${header}\n\nregisterInjects([]);\n`);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        expect(await main(['build', '--project', path.join(project, 'tsconfig.json')])).toBe(0);
        log.mockRestore();
        expect(await readFile(file, 'utf8')).toBe(shipped);
      },
      60_000,
    );

    it('ships the dependency lists avi inject generates, and no static inject', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await main([
        'inject',
        '--project',
        path.join(project, 'tsconfig.json'),
        '--out',
        path.join(project, 'src/inject.gen.ts'),
        '--check',
      ]);
      log.mockRestore();
      expect(code).toBe(0);
      if (template === 'modular') {
        const controller = await readFile(
          path.join(project, 'src/modules/users/users.controller.ts'),
          'utf8',
        );
        expect(controller).not.toContain('static inject');
      }
    }, 60_000);
  },
);

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
    expect(lines).toEqual([
      'watch tsconfig.json',
      'node --watch --watch-preserve-output dist/main.js',
    ]);
  });

  it('keeps the client file in step with --dry-run in a generated project', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await main(['new', 'dev-client', '--dir', workdir]);
    const cwd = process.cwd();
    process.chdir(path.join(workdir, 'dev-client'));
    try {
      expect(await main(['dev', '--dry-run'])).toBe(0);
      expect(await main(['dev', '--dry-run', '--no-client', '--no-inject'])).toBe(0);
    } finally {
      process.chdir(cwd);
    }
    const lines = log.mock.calls.map((call) => String(call[0]));
    log.mockRestore();
    expect(lines).toContain(
      'watch tsconfig.json, updating src/api.gen.ts when routes change, updating src/inject.gen.ts when constructors change',
    );
    expect(lines.at(-2)).toBe('watch tsconfig.json');
  });

  it('prints usage', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['help'])).toBe(0);
    expect(await main(['unknown'])).toBe(2);
    error.mockRestore();
  });
});

const CLIENT_NOTE = '`avi dev` adds the new routes to src/api.gen.ts; otherwise run `avi client`.';

describe('avi generate', () => {
  async function project(
    template: 'modular' | 'minimal',
    name: string,
    validator = 'valibot',
  ): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await main(['new', name, '--template', template, '--validator', validator, '--dir', workdir]);
    log.mockRestore();
    const dir = path.join(workdir, name);
    await linkPackages(dir);
    return dir;
  }

  async function generate(dir: string, ...args: string[]) {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const code = await main(['g', ...args, '--root', dir]);
      return {
        code,
        out: log.mock.calls.map((call) => String(call[0])),
        err: error.mock.calls.map((call) => String(call[0])),
      };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }

  const read = (dir: string, file: string) => readFile(path.join(dir, file), 'utf8');

  it('adds a module, service and controller to a modular project', async () => {
    const dir = await project('modular', 'gen-modular');

    expect((await generate(dir, 'module', 'posts')).out).toEqual([
      'CREATE src/modules/posts/posts.module.ts',
      'UPDATE src/app.module.ts',
    ]);
    expect((await generate(dir, 's', 'posts')).out).toEqual([
      'CREATE src/modules/posts/posts.service.ts',
      'UPDATE src/modules/posts/posts.module.ts',
    ]);
    expect((await generate(dir, 'co', 'posts')).out).toEqual([
      'CREATE src/modules/posts/posts.controller.ts',
      'UPDATE src/modules/posts/posts.module.ts',
      'UPDATE src/inject.gen.ts',
      CLIENT_NOTE,
    ]);
    expect((await generate(dir, 'controller', 'admin/reports')).out).toEqual([
      'CREATE src/modules/admin/reports/reports.controller.ts',
      'UPDATE src/app.module.ts',
      CLIENT_NOTE,
    ]);

    expect(await read(dir, 'src/modules/posts/posts.module.ts')).toBe(
      `import { Module } from '@avijs/core';
import { PostsService } from './posts.service.js';
import { PostsController } from './posts.controller.js';

@Module({ providers: [PostsService], controllers: [PostsController] })
export class PostsModule {}
`,
    );
    const app = await read(dir, 'src/app.module.ts');
    expect(app).toContain("import { PostsModule } from './modules/posts/posts.module.js';");
    expect(app).toContain(
      "import { ReportsController } from './modules/admin/reports/reports.controller.js';",
    );
    expect(app).toContain(
      '@Module({ imports: [Config.module, UsersModule, PostsModule], controllers: [HealthController, ReportsController] })',
    );
    // The project infers dependency lists: none in the class, and avi g updated inject.gen.ts.
    expect(await read(dir, 'src/modules/posts/posts.controller.ts')).not.toContain('static inject');
    expect(await read(dir, 'src/inject.gen.ts')).toContain('[PostsController, [PostsService]],');

    const result = run([tsc, '-p', 'tsconfig.json'], dir);
    expect(result.stdout + result.stderr).toBe('');
    expect(await startAndGet(dir, '/posts')).toEqual({ status: 200, body: '[]' });
    expect(await startAndGet(dir, '/reports')).toEqual({ status: 200, body: '[]' });
  }, 120_000);

  it('adds a service and routes to a minimal project', async () => {
    const dir = await project('minimal', 'gen-minimal');

    expect((await generate(dir, 'service', 'posts')).out).toEqual([
      'CREATE src/services/posts.ts',
      'UPDATE src/app.ts',
    ]);
    expect((await generate(dir, 'controller', 'posts')).out).toEqual([
      'CREATE src/routes/posts.ts',
      'UPDATE src/app.ts',
      CLIENT_NOTE,
    ]);
    const app = await read(dir, 'src/app.ts');
    expect(app).toContain('providers: [UsersService, PostsService]');
    expect(app).toContain('controllers: [healthRoutes, usersRoutes, postsRoutes]');
    expect(await read(dir, 'src/routes/posts.ts')).toContain('inject: [PostsService]');

    const module = await generate(dir, 'module', 'posts');
    expect(module.code).toBe(1);
    expect(module.err[0]).toContain('does not use modules');

    const result = run([tsc, '-p', 'tsconfig.json'], dir);
    expect(result.stdout + result.stderr).toBe('');
    expect(await startAndGet(dir, '/posts')).toEqual({ status: 200, body: '[]' });
  }, 120_000);

  it('previews with --dry-run, refuses to overwrite and validates input', async () => {
    const dir = await project('modular', 'gen-checks');

    const dry = await generate(dir, 'service', 'billing', '--dry-run');
    expect(dry.out).toEqual([
      'CREATE src/modules/billing/billing.service.ts',
      'UPDATE src/app.module.ts',
      'Dry run: nothing was written.',
    ]);
    expect(await read(dir, 'src/app.module.ts')).not.toContain('BillingService');

    const twice = await generate(dir, 'service', 'users');
    expect(twice.code).toBe(1);
    expect(twice.err[0]).toContain('already exists');

    expect((await generate(dir, 'controller', 'Bad/Name')).code).toBe(2);
    expect((await generate(dir, 'widget', 'x')).code).toBe(2);
    expect((await generate(path.join(workdir, 'nowhere'), 'service', 'x')).code).toBe(1);
  }, 60_000);

  /** Runs a CRUD sequence against a running app and returns each status and body. */
  async function crud(dir: string, prefix: string) {
    return withApp(dir, async (base) => {
      const send = async (method: string, urlPath: string, body?: unknown) => {
        const res = await fetch(`${base}${prefix}${urlPath}`, {
          method,
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          body: body === undefined ? null : JSON.stringify(body),
        });
        return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
      };
      return [
        await send('POST', '', { title: 'Hello' }),
        await send('GET', ''),
        await send('PATCH', '/1', { title: 'Hi', id: 99 }),
        await send('GET', '/1'),
        await send('POST', '', [1, 2]),
        await send('GET', '/abc'),
        await send('POST', '', { title: 'Two', role: 'admin' }),
        await send('PATCH', '/1', {}),
        await send('DELETE', '/1'),
        await send('GET', '/1'),
      ].map((r) => [r.status, r.body] as const);
    });
  }

  const shared = [
    [201, { title: 'Hello', id: 1 }],
    [200, [{ title: 'Hello', id: 1 }]],
    [200, { title: 'Hi', id: 1 }],
    [200, { title: 'Hi', id: 1 }],
  ];
  const notFound = [404, expect.objectContaining({ message: 'Category 1 not found' })];

  const EXPECTED_CRUD = {
    // Without a validator, extra fields are stored as sent; the generator warns about it.
    none: [
      ...shared,
      [400, expect.objectContaining({ message: 'Expected a JSON object' })],
      [400, expect.objectContaining({ message: 'id must be an integer' })],
      [201, { title: 'Two', role: 'admin', id: 2 }],
      [200, { title: 'Hi', id: 1 }],
      [204, undefined],
      notFound,
    ],
    schema: [
      ...shared,
      [400, expect.objectContaining({ message: 'Validation failed' })],
      [400, expect.objectContaining({ message: 'Validation failed' })],
      [201, { title: 'Two', id: 2 }],
      [
        400,
        expect.objectContaining({
          details: { issues: [expect.objectContaining({ message: 'nothing to update' })] },
        }),
      ],
      [204, undefined],
      notFound,
    ],
  };

  const NOTE: unknown = expect.stringContaining('NOTE   No validation library');

  describe.each(['valibot', 'zod', 'none'] as const)('resource with validator %s', (validator) => {
    const expected = validator === 'none' ? EXPECTED_CRUD.none : EXPECTED_CRUD.schema;

    it('creates a CRUD resource in a modular project', async () => {
      const dir = await project('modular', `res-modular-${validator}`, validator);

      const folder = 'src/modules/shop/categories';
      expect((await generate(dir, 'res', 'shop/categories')).out).toEqual(
        validator === 'none'
          ? [
              `CREATE ${folder}/categories.module.ts`,
              `CREATE ${folder}/categories.service.ts`,
              `CREATE ${folder}/categories.controller.ts`,
              'UPDATE src/app.module.ts',
              'UPDATE src/inject.gen.ts',
              NOTE,
              CLIENT_NOTE,
            ]
          : [
              `CREATE ${folder}/categories.module.ts`,
              `CREATE ${folder}/categories.schemas.ts`,
              `CREATE ${folder}/categories.service.ts`,
              `CREATE ${folder}/categories.controller.ts`,
              'UPDATE src/app.module.ts',
              'UPDATE src/inject.gen.ts',
              CLIENT_NOTE,
            ],
      );
      expect(await read(dir, 'src/app.module.ts')).toContain(
        "import { CategoriesModule } from './modules/shop/categories/categories.module.js';",
      );

      const result = run([tsc, '-p', 'tsconfig.json'], dir);
      expect(result.stdout + result.stderr).toBe('');
      expect(await crud(dir, '/categories')).toEqual(expected);

      const again = await generate(dir, 'resource', 'shop/categories');
      expect(again.code).toBe(1);
      expect(again.err[0]).toContain('already exists');
    }, 120_000);

    it('creates a CRUD resource in a minimal project', async () => {
      const dir = await project('minimal', `res-minimal-${validator}`, validator);

      expect((await generate(dir, 'resource', 'categories')).out).toEqual(
        validator === 'none'
          ? [
              'CREATE src/services/categories.ts',
              'CREATE src/routes/categories.ts',
              'UPDATE src/app.ts',
              NOTE,
              CLIENT_NOTE,
            ]
          : [
              'CREATE src/schemas/categories.ts',
              'CREATE src/services/categories.ts',
              'CREATE src/routes/categories.ts',
              'UPDATE src/app.ts',
              CLIENT_NOTE,
            ],
      );
      const app = await read(dir, 'src/app.ts');
      expect(app).toContain('providers: [UsersService, CategoriesService]');
      expect(app).toContain('controllers: [healthRoutes, usersRoutes, categoriesRoutes]');

      const result = run([tsc, '-p', 'tsconfig.json'], dir);
      expect(result.stdout + result.stderr).toBe('');
      expect(await crud(dir, '/categories')).toEqual(expected);
    }, 120_000);
  });

  it('detects the validator from package.json, or takes --validator', async () => {
    const dir = await project('modular', 'res-detect', 'zod');
    const files = async (...extra: string[]) =>
      (await generate(dir, 'res', 'tags', '--dry-run', ...extra)).out;

    expect(await files()).toContain('CREATE src/modules/tags/tags.schemas.ts');
    expect(await files('--validator', 'none')).toEqual(expect.arrayContaining([NOTE]));

    const unknown = await generate(dir, 'res', 'tags', '--validator', 'yup');
    expect(unknown.code).toBe(2);
    expect(unknown.err[0]).toContain('Unknown validator "yup"');
  }, 60_000);
});

describe('avi usage mistakes', () => {
  it('answers --help for every command, and turns bad options into usage', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['generate', '--help'])).toBe(0);
    expect(await main(['new', 'x', '-h'])).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toContain('Usage:');
    expect(await main(['--version'])).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+/));
    expect(await main(['g', '--help'])).toBe(0);
    expect(String(log.mock.lastCall?.[0])).not.toContain('avi dev');
    expect(await main(['inject', '--help'])).toBe(0);
    expect(String(log.mock.lastCall?.[0])).toMatch(/^Usage:\n {2}avi inject /);
    expect(String(log.mock.lastCall?.[0])).not.toContain('avi client');
    expect(await main(['nope', '--help'])).toBe(0);
    expect(String(log.mock.lastCall?.[0])).toContain('avi dev');
    expect(await main(['build', '--nope'])).toBe(2);
    expect(String(error.mock.calls[0]?.[0])).toContain("Unknown option '--nope'");
    log.mockRestore();
    error.mockRestore();
  });

  it('explains a stray argument from npm create without --', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['new', 'shop', 'minimal', '--dir', workdir])).toBe(2);
    expect(String(error.mock.calls[0]?.[0])).toContain('put options after --');
    error.mockRestore();
  });
});
