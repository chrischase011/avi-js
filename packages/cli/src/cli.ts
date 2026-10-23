import { main as compile } from '@avijs/compiler';
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
  avi dev [--project tsconfig.json] [--entry dist/main.js]
      Compile, then recompile and restart on every change.
  avi check [--project tsconfig.json]
      Type-check every static inject list.
  avi manifest <entry.js> [--export AppModule] [--out avi.manifest.json]
      Describe the app's modules, providers and routes.
  avi client [--out src/api.gen.ts] [--project tsconfig.json] [--root file.ts#AppModule] [--check]
      Generate the typed Api for @avijs/client from the app's routes. --check fails when the
      file is out of date, for CI.`;

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
      'dry-run': { type: 'boolean', default: false },
    },
  });

  let tsc: string;
  try {
    tsc = createRequire(path.resolve('package.json')).resolve('typescript/bin/tsc');
  } catch {
    console.error('avi dev needs TypeScript installed in this project: npm install -D typescript');
    return 1;
  }

  const build = [tsc, '-p', values.project];
  const watchBuild = [tsc, '-p', values.project, '--watch', '--preserveWatchOutput'];
  const watchRun = ['--watch', '--watch-preserve-output', values.entry];
  if (values['dry-run']) {
    for (const command of [build, watchBuild, watchRun]) {
      console.log(['node', ...command].join(' '));
    }
    return 0;
  }

  const first = spawnSync(process.execPath, build, { stdio: 'inherit' });
  if (first.status !== 0) return first.status ?? 1;

  const children: ChildProcess[] = [
    spawn(process.execPath, watchBuild, { stdio: 'inherit' }),
    spawn(process.execPath, watchRun, { stdio: 'inherit' }),
  ];
  return new Promise((resolve) => {
    const stop = () => {
      for (const child of children) child.kill();
      resolve(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    for (const child of children) {
      child.once('exit', (code) => {
        if (code !== null && code !== 0) {
          for (const other of children) other.kill();
          resolve(code);
        }
      });
    }
  });
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
