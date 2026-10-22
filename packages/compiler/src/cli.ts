import { parseArgs } from 'node:util';
import { checkInjectLists, type Diagnostic } from './check.js';
import { writeManifest } from './manifest.js';

const USAGE = `Usage:
  avi-compile check [--project tsconfig.json]
      Type-check every static inject list against its constructor.
  avi-compile manifest <entry.js> [--export AppModule] [--out avi.manifest.json]
      Describe the app's modules, providers and routes without starting it.`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: [...rest],
    allowPositionals: true,
    options: {
      project: { type: 'string', default: 'tsconfig.json' },
      export: { type: 'string', default: 'AppModule' },
      out: { type: 'string', default: 'avi.manifest.json' },
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

  if (command === 'manifest' && positionals[0]) {
    const description = await writeManifest({
      entry: positionals[0],
      exportName: values.export,
      out: values.out,
    });
    console.log(
      `Wrote ${values.out}: ${String(description.modules.length)} modules, ${String(description.routes.length)} routes`,
    );
    for (const controller of description.dynamic) {
      console.log(`note: ${controller} creates its routes at runtime; they are not listed`);
    }
    return 0;
  }

  console.error(USAGE);
  return 2;
}

function format(d: Diagnostic): string {
  return `${d.file}:${String(d.line)}:${String(d.column)} ${d.severity} ${d.code}: ${d.message}`;
}
