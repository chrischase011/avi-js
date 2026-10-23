import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkInjectLists, type Diagnostic } from './check.js';
import { generateClient } from './client.js';
import { writeManifest } from './manifest.js';

const USAGE = `Usage:
  avi-compile check [--project tsconfig.json]
      Type-check every static inject list against its constructor.
  avi-compile manifest <entry.js> [--export AppModule] [--out avi.manifest.json]
      Describe the app's modules, providers and routes without starting it.
  avi-compile client [--project tsconfig.json] [--out src/api.gen.ts] [--root file.ts#AppModule] [--check]
      Generate the Api type for @avijs/client. --check fails if the file is out of date.`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: [...rest],
    allowPositionals: true,
    options: {
      project: { type: 'string', default: 'tsconfig.json' },
      export: { type: 'string', default: 'AppModule' },
      out: { type: 'string' },
      root: { type: 'string' },
      check: { type: 'boolean', default: false },
    },
  });

  if (command === 'check') {
    const diagnostics = checkInjectLists(values.project);
    for (const d of diagnostics) console.log(format(d));
    const errors = diagnostics.filter((d) => d.severity === 'error').length;
    console.log(
      `${String(errors)} error(s), ${String(diagnostics.length - errors)} warning(s) in static inject lists`,
    );
    return errors > 0 ? 1 : 0;
  }

  if (command === 'client') {
    return client(values.project, values.out ?? 'src/api.gen.ts', values.root, values.check);
  }

  if (command === 'manifest' && positionals[0]) {
    const out = values.out ?? 'avi.manifest.json';
    const description = await writeManifest({
      entry: positionals[0],
      exportName: values.export,
      out,
    });
    console.log(
      `Wrote ${out}: ${String(description.modules.length)} modules, ${String(description.routes.length)} routes`,
    );
    for (const controller of description.dynamic) {
      console.log(`note: ${controller} creates its routes at runtime; they are not listed`);
    }
    return 0;
  }

  console.error(USAGE);
  return 2;
}

async function client(
  project: string,
  out: string,
  root: string | undefined,
  check: boolean,
): Promise<number> {
  const result = generateClient({ project, out, root });
  for (const d of result.diagnostics) console.log(format(d));
  if (result.diagnostics.some((d) => d.severity === 'error')) return 1;

  const routes = `${String(result.routes.length)} routes`;
  if (check) {
    const current = await readFile(out, 'utf8').catch(() => undefined);
    // Formatters may rewrap the file; only the content counts.
    const same = current !== undefined && squash(current) === squash(result.source);
    console.log(
      same ? `${out} is up to date (${routes})` : `${out} is out of date: run avi client`,
    );
    return same ? 0 : 1;
  }
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, result.source);
  console.log(`Wrote ${out}: ${routes}`);
  return 0;
}

const squash = (text: string) => text.replace(/[\s,;]+/g, '');

function format(d: Diagnostic): string {
  return `${d.file}:${String(d.line)}:${String(d.column)} ${d.severity} ${d.code}: ${d.message}`;
}
