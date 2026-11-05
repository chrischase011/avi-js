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
  project: string,
  written: Iterable<string>,
): void {
  const folder = outputFolder(outDir, path.dirname(path.resolve(project)));
  if (!folder) return;
  const { out, key } = folder;
  const id = projectId(folder, project);
  const lists = readMarker(out);
  const current = relativeTo(folder, written).sort();
  // Files another tsconfig compiled here stay.
  const keep = new Set(current.map(key));
  for (const [other, files] of lists) {
    if (other !== id) for (const file of files) keep.add(key(file));
  }
  for (const relative of lists.get(id) ?? []) {
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
  lists.set(id, current);
  writeMarker(out, lists);
}

/**
 * Adds files a watch build wrote to the list, without removing anything: it only emits what
 * changed. The next full build removes the ones whose source is gone.
 */
export function recordOutputs(
  outDir: string | undefined,
  project: string,
  written: Iterable<string>,
): void {
  const folder = outputFolder(outDir, path.dirname(path.resolve(project)));
  if (!folder) return;
  const id = projectId(folder, project);
  const lists = readMarker(folder.out);
  const files = new Map((lists.get(id) ?? []).map((file) => [folder.key(file), file]));
  const before = files.size;
  for (const file of relativeTo(folder, written)) files.set(folder.key(file), file);
  if (files.size === before && existsSync(path.join(folder.out, MARKER))) return;
  lists.set(id, [...files.values()].sort());
  writeMarker(folder.out, lists);
}

/** A tsconfig's key in the list: its path from the output folder, so the project can move. */
function projectId(folder: OutputFolder, project: string): string {
  const relative = path.relative(folder.configured, path.resolve(project));
  return folder.key(relative.split(path.sep).join('/'));
}

function writeMarker(out: string, lists: Map<string, string[]>): void {
  const projects = Object.fromEntries([...lists].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    path.join(out, MARKER),
    `${JSON.stringify({ note: 'Written by avi build and avi dev: the files each tsconfig compiled here, so the next build can remove the ones whose source is gone.', projects }, null, 2)}\n`,
  );
}

/**
 * The lists by tsconfig. A list from before 1.0.0-rc.6 does not say which tsconfig wrote it, so
 * nothing on it is removed; the build replaces it with its own.
 */
function readMarker(out: string): Map<string, string[]> {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((file): file is string => typeof file === 'string') : [];
  const lists = new Map<string, string[]>();
  try {
    const parsed = JSON.parse(readFileSync(path.join(out, MARKER), 'utf8')) as {
      projects?: unknown;
    };
    if (parsed.projects && typeof parsed.projects === 'object') {
      for (const [name, files] of Object.entries(parsed.projects)) lists.set(name, strings(files));
    }
  } catch {
    // No list yet, or one that cannot be read: nothing to remove.
  }
  return lists;
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
