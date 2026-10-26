import { buildProject, main as compile, watchProject } from '@avijs/compiler';
import { spawn, type ChildProcess } from 'node:child_process';
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
      Compile, then recompile and restart on every change. Keeps src/api.gen.ts (when the
      project has one) in step with the routes.
  avi build [--project tsconfig.json] [--client src/api.gen.ts | --no-client]
      Update src/api.gen.ts, empty the output folder, and compile, so files deleted from
      src do not linger in dist.
  avi check [--project tsconfig.json]
      Type-check every static inject list.
  avi manifest <entry.js> [--export AppModule] [--out avi.manifest.json]
      Describe the app's modules, providers and routes.
  avi client [--out src/api.gen.ts] [--project tsconfig.json] [--root file.ts#AppModule] [--check | --watch]
      Generate the typed Api for @avijs/client from the app's routes. --check fails when the
      file is out of date, for CI; --watch updates it on every change.`;

export async function main(argv: readonly string[]): Promise<number> {
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
  npm run dev`);
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
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const client = clientFile(values.project, values.client, values['no-client']);
  const run = ['--watch', '--watch-preserve-output', values.entry];
  if (values['dry-run']) {
    console.log(
      `watch ${values.project}${client ? `, updating ${client} when routes change` : ''}`,
    );
    console.log(['node', ...run].join(' '));
    return 0;
  }

  return new Promise((resolve) => {
    let app: ChildProcess | undefined;
    // The app starts after the first clean build; node --watch restarts it from then on.
    const watcher = watchProject({
      project: values.project,
      ...(client ? { client: { out: client } } : {}),
      onBuild: (errors) => {
        if (errors > 0 || app) return;
        app = spawn(process.execPath, run, { stdio: 'inherit' });
        app.once('exit', (code) => {
          if (code !== null && code !== 0) stop(code);
        });
      },
    });
    const stop = (code: number) => {
      watcher.close();
      app?.kill();
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

function build(args: readonly string[]): number {
  const { values } = parseArgs({
    args: [...args],
    options: {
      project: { type: 'string', default: 'tsconfig.json' },
      client: { type: 'string' },
      'no-client': { type: 'boolean', default: false },
    },
  });
  const client = clientFile(values.project, values.client, values['no-client']);
  const errors = buildProject({
    project: values.project,
    ...(client ? { client: { out: client } } : {}),
  });
  return errors > 0 ? 1 : 0;
}

/** The client file to keep current: --client, else the project's src/api.gen.ts if it has one. */
function clientFile(project: string, client: string | undefined, off: boolean): string | undefined {
  if (off) return undefined;
  if (client) return client;
  const file = path.posix.join(path.dirname(project).replaceAll('\\', '/'), 'src/api.gen.ts');
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
