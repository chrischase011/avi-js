// Packs every package, checks what each tarball contains, then installs the tarballs into fresh
// npm projects and uses them like a real consumer: ESM, CommonJS, TypeScript 6 and 7, and both
// `avi new` templates. Run after `pnpm build`. Needs network access for npm.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = path.join(root, 'artifacts');
const shell = process.platform === 'win32';
const failures = [];

// Windows needs a shell to run npm/pnpm/npx (.cmd files); pass one quoted command string.
const quote = (arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);

function run(command, args, cwd, { quiet = false } = {}) {
  const result = shell
    ? spawnSync([command, ...args].map(quote).join(' '), { cwd, encoding: 'utf8', shell })
    : spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}\n${result.stdout}${result.stderr}`,
    );
  }
  if (!quiet && result.stdout.trim()) console.log(result.stdout.trim());
  return result.stdout;
}

function step(name, fn) {
  process.stdout.write(`- ${name} ... `);
  try {
    fn();
    console.log('ok');
  } catch (error) {
    console.log('FAILED');
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 1. Pack.
rmSync(artifacts, { recursive: true, force: true });
mkdirSync(artifacts);
const packages = readdirSync(path.join(root, 'packages'));
for (const name of packages) {
  run('pnpm', ['pack', '--pack-destination', artifacts], path.join(root, 'packages', name), {
    quiet: true,
  });
}
const tarballs = readdirSync(artifacts).filter((file) => file.endsWith('.tgz'));
console.log(`Packed ${String(tarballs.length)} packages into artifacts/`);

// 2. Inspect contents.
for (const tarball of tarballs) {
  step(`contents of ${tarball}`, () => {
    // Run tar inside artifacts/ with a bare file name: GNU tar reads 'C:' as a remote host.
    const files = run('tar', ['-tzf', tarball], artifacts, { quiet: true })
      .split('\n')
      .filter(Boolean);
    for (const required of [
      'package/package.json',
      'package/README.md',
      'package/LICENSE',
      'package/dist/index.js',
      'package/dist/index.d.ts',
    ]) {
      if (!files.includes(required)) throw new Error(`missing ${required}`);
    }
    const unwanted = files.filter((file) =>
      /^package\/(test|node_modules)\/|\.tsbuildinfo$|tsconfig/.test(file),
    );
    if (unwanted.length) throw new Error(`should not ship ${unwanted.join(', ')}`);
    const manifest = run('tar', ['-xzOf', tarball, 'package/package.json'], artifacts, {
      quiet: true,
    });
    if (manifest.includes('workspace:'))
      throw new Error('package.json still has workspace: ranges');
  });
}

// 3. A consumer project installing the tarballs.
const work = mkdtempSync(path.join(tmpdir(), 'avi-artifacts-'));
const local = Object.fromEntries(
  tarballs.map((file) => [
    file.startsWith('avijs-')
      ? `@avijs/${/^avijs-(.+?)-\d/.exec(file)[1]}`
      : /^(.+?)-\d/.exec(file)[1],
    `file:${path.join(artifacts, file).replaceAll('\\', '/')}`,
  ]),
);
const consumer = path.join(work, 'consumer');
mkdirSync(path.join(consumer, 'src'), { recursive: true });
writeFileSync(
  path.join(consumer, 'package.json'),
  JSON.stringify(
    {
      name: 'avi-artifact-check',
      private: true,
      type: 'module',
      dependencies: local,
      devDependencies: { typescript: '6.0.3', '@types/node': '22.20.5', valibot: '1.5.0' },
      overrides: local,
    },
    null,
    2,
  ),
);
writeFileSync(
  path.join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2023',
      lib: ['ES2023', 'ESNext.Disposable'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      types: ['node'],
      strict: true,
      outDir: 'dist',
      rootDir: 'src',
    },
    include: ['src'],
  }),
);
writeFileSync(
  path.join(consumer, 'src/app.ts'),
  `import assert from 'node:assert/strict';
import { AviFactory, Controller, Get, Injectable, Module, createToken, route, defineController, type Context, type MethodEndpoint } from '@avijs/core';
import { createClient } from '@avijs/client';
import { createTestClient } from '@avijs/testing';
import { generateOpenApi } from '@avijs/openapi';
import { cors } from '@avijs/security';
import * as v from 'valibot';

const Greeting = createToken<string>('Greeting');

@Injectable()
class Greeter {
  static inject = [Greeting] as const;
  constructor(private readonly greeting: string) {}
  greet(name: string) { return \`\${this.greeting}, \${name}!\`; }
}

@Controller('/greet')
class GreetController {
  static inject = [Greeter] as const;
  constructor(private readonly greeter: Greeter) {}
  @Get('/:name')
  greet(ctx: Context) { return { message: this.greeter.greet(ctx.params['name'] ?? '') }; }
}

const items = defineController({
  prefix: '/items',
  routes: [route({ method: 'POST', path: '/', schema: { body: v.object({ name: v.string() }) }, handler: (ctx) => ctx.input.body })],
});

@Module({ providers: [Greeter, { provide: Greeting, useValue: 'Hello' }], controllers: [GreetController, items] })
class AppModule {}

const app = await AviFactory.create(AppModule, { onRequest: [cors({ origin: 'https://a.example' })] });
const client = await createTestClient(app);
assert.deepEqual((await client.get('/greet/Shiela')).body, { message: 'Hello, Shiela!' });
assert.equal((await client.post('/items', {})).status, 400);
assert.equal((await client.get('/greet/Shiela', { headers: { origin: 'https://a.example' } })).headers.get('access-control-allow-origin'), 'https://a.example');
assert.ok(generateOpenApi(app, { info: { title: 'T', version: '1' } }).paths['/greet/{name}']);
interface Api { 'GET /greet/:name': MethodEndpoint<'/greet/:name', GreetController['greet']> }
const greeting: { message: string } = await createClient<Api>({ baseUrl: client.url }).get('/greet/:name', { params: { name: 'Shiela' } });
assert.deepEqual(greeting, { message: 'Hello, Shiela!' });
await client.close();
console.log('consumer app ok');
`,
);
writeFileSync(
  path.join(consumer, 'require.cjs'),
  `const assert = require('node:assert/strict');
const core = require('@avijs/core');
assert.equal(typeof core.createAvi, 'function');
assert.equal(typeof require('@avijs/testing').createTestClient, 'function');
assert.equal(typeof require('@avijs/multipart').readForm, 'function');
assert.equal(typeof require('@avijs/client').createClient, 'function');
assert.equal(typeof require('@avijs/workers').cluster, 'function');
console.log('require(esm) ok');
`,
);

step('npm install of the tarballs', () =>
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], consumer, { quiet: true }),
);
step('TypeScript 6 compiles a consumer using decorators', () =>
  run('npx', ['tsc', '-p', 'tsconfig.json'], consumer),
);
step('the compiled consumer runs', () => run(process.execPath, ['dist/app.js'], consumer));
step('CommonJS can require the packages', () => run(process.execPath, ['require.cjs'], consumer));
step('TypeScript 7 accepts the published types', () =>
  run(
    'npx',
    ['--yes', '-p', 'typescript@7.0.2', 'tsc', '-p', 'tsconfig.json', '--noEmit'],
    consumer,
  ),
);

step('create-avi scaffolds a project', () => {
  run(
    process.execPath,
    ['node_modules/create-avi/dist/bin.js', 'created', '--template', 'minimal', '--dir', work],
    consumer,
    { quiet: true },
  );
  readdirSync(path.join(work, 'created', 'src'));
});

// 4. Both templates, installed from the tarballs.
for (const template of ['modular', 'minimal']) {
  const name = `quickstart-${template}`;
  step(`avi new --template ${template} --from artifacts`, () =>
    run(
      process.execPath,
      [
        path.join(root, 'packages/cli/dist/bin.js'),
        'new',
        name,
        '--template',
        template,
        '--dir',
        work,
        '--from',
        artifacts,
      ],
      work,
      { quiet: true },
    ),
  );
  const project = path.join(work, name);
  step(`${name}: npm install`, () =>
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], project, {
      quiet: true,
    }),
  );
  step(`${name}: npm test`, () => run('npm', ['test'], project, { quiet: true }));
  step(`${name}: avi check`, () => run('npx', ['avi', 'check'], project, { quiet: true }));
}

rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${String(failures.length)} check(s) failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log('\nAll artifact checks passed.');
