import { buildProject, main as compile, watchProject } from '@avijs/compiler';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { GENERATE_USAGE, generate } from './generate.js';
import { templateFiles } from './templates.js';
import { VALIDATORS, type Validator } from './validators.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const USAGE = `Usage:
  avi new <name> [--template modular|minimal] [--validator valibot|zod|none] [--dir .]
          [--avi-version ^x.y.z] [--from <dir>]
      Create a project. The modular template (default) uses modules and decorators;
      minimal uses plain routes and services. --validator picks the schema library for
      route validation (default valibot); none keeps handwritten checks. --from points at
      a folder of packed @avijs tarballs (pnpm pack) to install instead of the registry.
      --avi-version defaults to this CLI's version.
${GENERATE_USAGE}
  avi dev [--project tsconfig.json] [--entry dist/main.js] [--client src/api.gen.ts | --no-client]
          [--inject src/inject.gen.ts | --no-inject] [--root file.ts#AppModule]
      Compile, then recompile and restart on every change. Keeps src/api.gen.ts and
      src/inject.gen.ts (when the project has them) in step with the code.
  avi build [--project tsconfig.json] [--client ... | --no-client] [--inject ... | --no-inject]
          [--root file.ts#AppModule]
      Update the generated files, compile, and remove compiled files whose source is gone.
  avi check [--project tsconfig.json]
      Type-check every static inject list.
  avi manifest <entry.js> [--export AppModule] [--out avi.manifest.json]
      Describe the app's modules, providers and routes.
  avi client [--out src/api.gen.ts] [--project tsconfig.json] [--root file.ts#AppModule] [--check | --watch]
      Generate the typed Api for @avijs/client from the app's routes. --check fails when the
      file is out of date, for CI; --watch updates it on every change.
  avi inject [--out src/inject.gen.ts] [--project tsconfig.json] [--check | --watch]
      Infer the dependency lists of classes without static inject from their constructor
      types, for src/inject.gen.ts. --check fails when the file is out of date.
  avi --version`;

export async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(version);
    return 0;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    const generating = argv[0] === 'generate' || argv[0] === 'g';
    console.log(
      generating
        ? `Usage:
${GENERATE_USAGE}`
        : USAGE,
    );
    return 0;
  }
  try {
    return await run(argv);
  } catch (error) {
    // parseArgs rejects unknown options and missing values; that is a usage mistake, not a crash.
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_')) {
      console.error(`${(error as Error).message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
}

async function run(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'new':
      return create(rest);
    case 'generate':
    case 'g':
      return generate(rest);
    case 'dev':
      return dev(rest);
    case 'build':
      return build(rest);
    case 'check':
    case 'manifest':
    case 'client':
    case 'inject':
      return compile(argv);
    default:
      console.error(USAGE);
      return command === undefined || command === 'help' || command === '--help' ? 0 : 2;
  }
}

async function create(args: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      template: { type: 'string', default: 'modular' },
      validator: { type: 'string', default: 'valibot' },
      dir: { type: 'string', default: '.' },
      'avi-version': { type: 'string', default: `^${version}` },
      from: { type: 'string' },
    },
  });
  const name = positionals[0];
  if (positionals.length > 1) {
    // npm create keeps unknown flags for itself and passes their values on as arguments.
    console.error(
      `Unexpected argument "${String(positionals[1])}". With npm create, put options after --: npm create avi@${version.includes('-') ? 'next' : 'latest'} ${String(name)} -- --template minimal`,
    );
    return 2;
  }
  if (!name || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    console.error('avi new needs a project name in lowercase letters, digits, ".", "_" or "-"');
    return 2;
  }
  const template = values.template;
  if (template !== 'modular' && template !== 'minimal') {
    console.error(`Unknown template "${template}". Use modular or minimal.`);
    return 2;
  }

  const validator = values.validator as Validator;
  if (!VALIDATORS.includes(validator)) {
    console.error(`Unknown validator "${values.validator}". Use ${VALIDATORS.join(', ')}.`);
    return 2;
  }

  const target = path.resolve(values.dir, name);
  if (existsSync(target) && (await readdir(target)).length > 0) {
    console.error(`${target} already exists and is not empty`);
    return 1;
  }

  const files = templateFiles({
    name,
    template,
    validator,
    aviVersion: values['avi-version'],
    ...(values.from ? { localPackages: await localPackages(values.from, target) } : {}),
  });
  for (const [file, content] of Object.entries(files)) {
    const destination = path.join(target, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }

  console.log(`Created ${name} (${template}, ${validator === 'none' ? 'no validator' : validator}) in ${target}

Next:
  cd ${path.relative(process.cwd(), target) || '.'}
  npm install
  npm run dev

To track it in git: git init && git add -A && git commit -m "Create project"`);
  return 0;
}

async function dev(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      project: { type: 'string', default: 'tsconfig.json' },
      entry: { type: 'string', default: 'dist/main.js' },
      client: { type: 'string' },
      'no-client': { type: 'boolean', default: false },
      inject: { type: 'string' },
      'no-inject': { type: 'boolean', default: false },
      root: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const client = generatedFile(values.project, values.client, values['no-client'], 'api.gen.ts');
  const inject = generatedFile(values.project, values.inject, values['no-inject'], 'inject.gen.ts');
  const run = ['--watch', '--watch-preserve-output', values.entry];
  if (values['dry-run']) {
    console.log(
      `watch ${values.project}${client ? `, updating ${client} when routes change` : ''}${inject ? `, updating ${inject} when constructors change` : ''}`,
    );
    console.log(['node', ...run].join(' '));
    return 0;
  }

  return new Promise((resolve) => {
    let app: ChildProcess | undefined;
    // The app starts after the first clean build; node --watch restarts it from then on.
    const watcher = watchProject({
      project: values.project,
      ...(client ? { client: { out: client, root: values.root } } : {}),
      ...(inject ? { inject: { out: inject } } : {}),
      onBuild: (errors) => {
        if (errors > 0 || app) return;
        // development unless set: cluster() then runs in one process, which node --watch restarts.
        const env = { ...process.env, NODE_ENV: process.env['NODE_ENV'] ?? 'development' };
        app = spawn(process.execPath, run, { stdio: 'inherit', env });
        app.once('exit', (code) => {
          if (code !== null && code !== 0) stop(code);
        });
      },
    });
    const stop = (code: number) => {
      watcher.close();
      if (app) killTree(app);
      resolve(code);
    };
    process.once('SIGINT', () => {
      stop(0);
    });
    process.once('SIGTERM', () => {
      stop(0);
    });
  });
}

/** Ends a child and what it started: on Windows kill() would leave node --watch's app running. */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}

function build(args: readonly string[]): number {
  const { values } = parseArgs({
    args: [...args],
    options: {
      project: { type: 'string', default: 'tsconfig.json' },
      client: { type: 'string' },
      'no-client': { type: 'boolean', default: false },
      inject: { type: 'string' },
      'no-inject': { type: 'boolean', default: false },
      root: { type: 'string' },
    },
  });
  const client = generatedFile(values.project, values.client, values['no-client'], 'api.gen.ts');
  const inject = generatedFile(values.project, values.inject, values['no-inject'], 'inject.gen.ts');
  const errors = buildProject({
    project: values.project,
    ...(client ? { client: { out: client, root: values.root } } : {}),
    ...(inject ? { inject: { out: inject } } : {}),
  });
  return errors > 0 ? 1 : 0;
}

/** A generated file to keep current: the flag's, else the project's src/<name> if it has one. */
function generatedFile(
  project: string,
  flag: string | undefined,
  off: boolean,
  name: string,
): string | undefined {
  if (off) return undefined;
  if (flag) return flag;
  const file = path.posix.join(path.dirname(project).replaceAll('\\', '/'), 'src', name);
  return existsSync(file) ? file : undefined;
}

/** Maps each packed @avi tarball in `dir` to a `file:` spec relative to the new project. */
async function localPackages(dir: string, project: string): Promise<Record<string, string>> {
  const folder = path.resolve(dir);
  const specs: Record<string, string> = {};
  for (const file of await readdir(folder)) {
    const match = /^avijs-([a-z-]+?)-\d+\.\d+\.\d+.*\.tgz$/.exec(file);
    if (!match?.[1]) continue;
    const relative = path.relative(project, path.join(folder, file)).replaceAll(path.sep, '/');
    specs[`@avijs/${match[1]}`] = `file:${relative}`;
  }
  if (!specs['@avijs/core']) throw new Error(`No @avijs package tarballs found in ${folder}`);
  return specs;
}
