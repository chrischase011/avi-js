import { existsSync, readdirSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { readConfig } from './check.js';
import { generatedWriters } from './watch.js';

export interface BuildProjectOptions {
  /** Path to tsconfig.json. */
  readonly project: string;
  /** Regenerate this `avi client` file before compiling. */
  readonly client?: { readonly out: string; readonly root?: string | undefined };
  /** Regenerate this `avi inject` file before compiling. */
  readonly inject?: { readonly out: string };
}

/** Marks an output folder `avi build` has written, the only kind it cleans. */
const MARKER = '.avi-build';
const OUTPUT = /\.(?:[cm]?js|d\.[cm]?ts|map)$/;

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
  if (config.errors.length === 0 && !emitted.emitSkipped) {
    removeStale(config, path.dirname(path.resolve(options.project)));
  }
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length;
  return errors + generated.reduce((sum, result) => sum + result.errors, 0);
}

/**
 * Deletes compiled files (`.js`, `.d.ts`, `.map`) in `outDir` that this build did not emit. Only
 * in a real folder inside the project, reached without links, not hidden or `node_modules`, and
 * marked by an earlier `avi build`; the first build only leaves the marker.
 */
function removeStale(config: ts.ParsedCommandLine, projectDir: string): void {
  const outDir = config.options.outDir;
  if (!outDir || !existsSync(outDir)) return;
  let out: string;
  let root: string;
  try {
    out = realpathSync.native(outDir);
    root = realpathSync.native(projectDir);
  } catch {
    return;
  }
  const ignoreCase = !ts.sys.useCaseSensitiveFileNames;
  const key = (relative: string) => (ignoreCase ? relative.toLowerCase() : relative);
  const inside = path.relative(root, out);
  // A link between the project and the output folder changes the path inside the project. Links
  // above the project (macOS /var, Windows short names) do not matter.
  const configured = path.relative(path.resolve(projectDir), path.resolve(outDir));
  if (key(inside) !== key(configured)) return;
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return;
  if (inside.split(path.sep).some((part) => part.startsWith('.') || part === 'node_modules')) {
    return;
  }

  const marker = path.join(out, MARKER);
  if (!existsSync(marker)) {
    writeFileSync(marker, 'Written by avi build, which removes stale compiled files here.\n');
    return;
  }
  // Compared by their place in the output folder: the real and the configured path may differ above it.
  const configuredOut = path.resolve(outDir);
  const expected = new Set(
    config.fileNames
      .flatMap((file) => ts.getOutputFileNames(config, file, ignoreCase))
      .map((file) => key(path.relative(configuredOut, path.resolve(file)))),
  );
  const sweep = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      // Dirents describe links as links, so nothing here follows one.
      if (entry.isDirectory()) {
        sweep(file);
        if (readdirSync(file).length === 0) rmdirSync(file);
      } else if (
        entry.isFile() &&
        OUTPUT.test(entry.name) &&
        !expected.has(key(path.relative(out, file)))
      ) {
        rmSync(file);
      }
    }
  };
  sweep(out);
}
