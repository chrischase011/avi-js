import { rmSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { readConfig } from './check.js';
import { clientWriter } from './watch.js';

export interface BuildProjectOptions {
  /** Path to tsconfig.json. */
  readonly project: string;
  /** Regenerate this `avi client` file before compiling. */
  readonly client?: { readonly out: string; readonly root?: string | undefined };
}

/**
 * Compiles a project like `tsc`, into an emptied `outDir` so files deleted from the source do not
 * linger in the output, and regenerates the client first. Returns the number of errors.
 */
export function buildProject(options: BuildProjectOptions): number {
  let config = readConfig(options.project);
  if (config.options.outDir) {
    clean(config.options.outDir, path.dirname(path.resolve(options.project)), config.fileNames);
  }

  let program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  if (options.client && clientWriter(options.client.out, options.client.root)(program)) {
    // Read the config again: the client file may be new.
    config = readConfig(options.project);
    program = ts.createProgram({
      rootNames: config.fileNames,
      options: config.options,
      oldProgram: program,
    });
  }

  const emitted = program.emit();
  const diagnostics = ts.sortAndDeduplicateDiagnostics([
    ...config.errors,
    ...ts.getPreEmitDiagnostics(program),
    ...emitted.diagnostics,
  ]);
  if (diagnostics.length > 0) {
    const host: ts.FormatDiagnosticsHost = {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => ts.sys.newLine,
    };
    process.stdout.write(
      process.stdout.isTTY
        ? ts.formatDiagnosticsWithColorAndContext(diagnostics, host)
        : ts.formatDiagnostics(diagnostics, host),
    );
  }
  return diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length;
}

/** Empties the output folder, but only one inside the project that holds none of its sources. */
function clean(outDir: string, projectDir: string, sources: readonly string[]): void {
  const out = path.resolve(outDir);
  const inside = path.relative(projectDir, out);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return;
  const holdsSource = sources.some((file) => !path.relative(out, file).startsWith('..'));
  if (!holdsSource) rmSync(out, { recursive: true, force: true });
}
