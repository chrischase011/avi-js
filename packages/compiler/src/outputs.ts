import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Lists the files `avi build` and `avi dev` compiled into an output folder. */
const MARKER = '.avi-build';
const OUTPUT = /\.(?:[cm]?js|d\.[cm]?ts|map)$/;

interface OutputFolder {
  /** The real path. */
  readonly out: string;
  /** The configured path, as the compiler writes to it. */
  readonly configured: string;
  readonly key: (relative: string) => string;
}

/**
 * The output folder, when it is safe to clean: a real folder inside the project, reached without
 * links, not hidden or `node_modules`.
 */
function outputFolder(outDir: string | undefined, projectDir: string): OutputFolder | undefined {
  if (!outDir || !existsSync(outDir)) return undefined;
  let out: string;
  let root: string;
  try {
    out = realpathSync.native(outDir);
    root = realpathSync.native(projectDir);
  } catch {
    return undefined;
  }
  const ignoreCase = !ts.sys.useCaseSensitiveFileNames;
  const key = (relative: string) => (ignoreCase ? relative.toLowerCase() : relative);
  const inside = path.relative(root, out);
  // A link between the project and the output folder changes the path inside the project. Links
  // above the project (macOS /var, Windows short names) do not matter.
  const configured = path.relative(path.resolve(projectDir), path.resolve(outDir));
  if (key(inside) !== key(configured)) return undefined;
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return undefined;
  if (inside.split(path.sep).some((part) => part.startsWith('.') || part === 'node_modules')) {
    return undefined;
  }
  return { out, configured: path.resolve(outDir), key };
}

/** Paths by their place in the output folder: the real and configured paths may differ above it. */
function relativeTo(folder: OutputFolder, written: Iterable<string>): string[] {
  return [...written]
    .map((file) => path.relative(folder.configured, file))
    .filter((relative) => relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    .map((relative) => relative.split(path.sep).join('/'));
}

/**
 * Deletes the files an earlier build wrote to `outDir` and this one did not, such as a deleted
 * module's tests. Nothing else in the folder is touched: hand-written files, a bundler's assets.
 */
export function removeStale(
  outDir: string | undefined,
  projectDir: string,
  written: Iterable<string>,
): void {
  const folder = outputFolder(outDir, projectDir);
  if (!folder) return;
  const { out, key } = folder;
  const current = relativeTo(folder, written).sort();
  const keep = new Set(current.map(key));
  for (const relative of readMarker(out)) {
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
    const dir = path.dirname(file);
    if (!stat.isFile() || key(realpathSync.native(dir)) !== key(dir)) continue;
    rmSync(file);
    removeEmptyDirs(path.dirname(file), out);
  }
  writeMarker(out, current);
}

/**
 * Adds files a watch build wrote to the list, without removing anything: it only emits what
 * changed. The next full build removes the ones whose source is gone.
 */
export function recordOutputs(
  outDir: string | undefined,
  projectDir: string,
  written: Iterable<string>,
): void {
  const folder = outputFolder(outDir, projectDir);
  if (!folder) return;
  const files = new Map(readMarker(folder.out).map((file) => [folder.key(file), file]));
  const before = files.size;
  for (const file of relativeTo(folder, written)) files.set(folder.key(file), file);
  if (files.size === before && existsSync(path.join(folder.out, MARKER))) return;
  writeMarker(folder.out, [...files.values()].sort());
}

function writeMarker(out: string, files: string[]): void {
  writeFileSync(
    path.join(out, MARKER),
    `${JSON.stringify({ note: 'Written by avi build and avi dev: the files they compiled here, so the next build can remove the ones whose source is gone.', files }, null, 2)}\n`,
  );
}

function readMarker(out: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(path.join(out, MARKER), 'utf8')) as {
      files?: unknown;
    };
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
