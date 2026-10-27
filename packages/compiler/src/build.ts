import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

  // What this build writes; the next build removes what it no longer writes.
  const written = new Set<string>();
  const emitted = program.emit(undefined, (file, text, bom) => {
    mkdirSync(path.dirname(file), { recursive: true });
    ts.sys.writeFile(file, text, bom);
    written.add(path.resolve(file));
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
    removeStale(config, path.dirname(path.resolve(options.project)), written);
  }
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length;
  return errors + generated.reduce((sum, result) => sum + result.errors, 0);
}

/**
 * Deletes the files an earlier `avi build` wrote to `outDir` and this one did not, such as a deleted
 * module's tests. Nothing else in the folder is touched: hand-written files, a bundler's assets.
 * Only in a real folder inside the project, reached without links, not hidden or `node_modules`.
 * The list of written files is kept in the marker file.
 */
function removeStale(config: ts.ParsedCommandLine, projectDir: string, written: Set<string>): void {
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

  // Paths by their place in the output folder: the real and configured paths may differ above it.
  const configuredOut = path.resolve(outDir);
  const current = [...written]
    .map((file) => path.relative(configuredOut, file))
    .filter((relative) => relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    .map((relative) => relative.split(path.sep).join('/'))
    .sort();
  const marker = path.join(out, MARKER);
  const previous = readMarker(marker);
  const keep = new Set(current.map(key));
  for (const relative of previous) {
    if (keep.has(key(relative)) || !OUTPUT.test(relative)) continue;
    const file = path.resolve(out, relative);
    const within = path.relative(out, file);
    if (!within || within.startsWith('..') || path.isAbsolute(within)) continue;
    let stat;
    try {
      stat = lstatSync(file);
    } catch {
      continue;
    }
    // Only a plain file: never a link, and never through one.
    if (!stat.isFile() || realpathSync.native(path.dirname(file)) !== path.dirname(file)) continue;
    rmSync(file);
    removeEmptyDirs(path.dirname(file), out);
  }
  writeFileSync(
    marker,
    `${JSON.stringify({ note: 'Written by avi build: the files it compiled here, so the next build can remove the ones whose source is gone.', files: current }, null, 2)}\n`,
  );
}

function readMarker(marker: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(marker, 'utf8')) as { files?: unknown };
    return Array.isArray(parsed.files)
      ? parsed.files.filter((file): file is string => typeof file === 'string')
      : [];
  } catch {
    return [];
  }
}

function removeEmptyDirs(dir: string, stop: string): void {
  for (
    let current = dir;
    current !== stop && current.startsWith(stop);
    current = path.dirname(current)
  ) {
    if (readdirSync(current).length > 0) return;
    rmdirSync(current);
  }
}
