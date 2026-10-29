import { mkdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { readConfig } from './check.js';
import { removeStale } from './outputs.js';
import { generatedWriters } from './watch.js';

export interface BuildProjectOptions {
  /** Path to tsconfig.json. */
  readonly project: string;
  /** Regenerate this `avi client` file before compiling. */
  readonly client?: { readonly out: string; readonly root?: string | undefined };
  /** Regenerate this `avi inject` file before compiling. */
  readonly inject?: { readonly out: string };
}

/**
 * Compiles a project like `tsc`, then removes compiled files whose source is gone, so a deleted
 * module's tests do not keep running. Regenerates the generated files first. Returns the number of
 * errors.
 */
export function buildProject(options: BuildProjectOptions): number {
  let config = readConfig(options.project);
  let program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  const generated = generatedWriters(options).map((writer) => writer.write(program));
  if (generated.some((result) => result.written)) {
    // Read the config again: a generated file may be new.
    config = readConfig(options.project);
    program = ts.createProgram({
      rootNames: config.fileNames,
      options: config.options,
      oldProgram: program,
    });
  }

  // What this build writes; the next build removes what it no longer writes.
  const written = new Set<string>();
  const emitted = program.emit(undefined, (file, text, bom, onError) => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      ts.sys.writeFile(file, text, bom);
      written.add(path.resolve(file));
    } catch (error) {
      // Reported as TS5033 "Could not write file", as tsc does.
      onError?.(error instanceof Error ? error.message : String(error));
    }
  });
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
  if (config.errors.length === 0 && !emitted.emitSkipped) {
    removeStale(config.options.outDir, path.dirname(path.resolve(options.project)), written);
  }
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length;
  return errors + generated.reduce((sum, result) => sum + result.errors, 0);
}
