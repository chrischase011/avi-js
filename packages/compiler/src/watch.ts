import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { formatDiagnostic } from './check.js';
import { generateFrom, sameContent } from './client.js';

export interface WatchProjectOptions {
  /** Path to tsconfig.json. */
  readonly project: string;
  /** Emit JavaScript and report type errors, like `tsc --watch`. Default true. */
  readonly emit?: boolean;
  /** Regenerate this `avi client` file after every build, writing it only when routes changed. */
  readonly client?: { readonly out: string; readonly root?: string | undefined };
  /** Called after every build with its type error count. */
  readonly onBuild?: (errors: number) => void;
}

export interface ProjectWatcher {
  close(): void;
}

/**
 * Watches a TypeScript project, like `tsc --watch`, and keeps the generated client in step with the
 * routes. The client is generated from the same incremental program, so nothing is parsed twice.
 */
export function watchProject(options: WatchProjectOptions): ProjectWatcher {
  const emit = options.emit ?? true;
  const host = ts.createWatchCompilerHost(
    path.resolve(options.project),
    emit ? { preserveWatchOutput: true } : { noEmit: true },
    ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    undefined,
    // Without emit the only output is the client's; tsc's status lines would be noise.
    emit ? undefined : () => undefined,
  );

  const status = host.onWatchStatusChange?.bind(host);
  host.onWatchStatusChange = (diagnostic, newLine, compilerOptions, errorCount) => {
    status?.(diagnostic, newLine, compilerOptions, errorCount);
    if (errorCount !== undefined) options.onBuild?.(errorCount);
  };

  const client = options.client && clientWriter(options.client.out, options.client.root);
  const build = host.afterProgramCreate?.bind(host);
  host.afterProgramCreate = (builder) => {
    const changed = client?.(builder.getProgram()) ?? false;
    if (!emit) options.onBuild?.(0);
    // Writing the client starts another build at once; this one would only report its stale errors.
    else if (!changed) build?.(builder);
  };

  const watcher = ts.createWatchProgram(host);
  return {
    close: () => {
      watcher.close();
    },
  };
}

export function clientWriter(out: string, root: string | undefined) {
  const file = path.resolve(out);
  let reported = '';
  /** Returns whether the file was written. */
  return (program: ts.Program): boolean => {
    const roots = new Set(program.getRootFileNames().map((name) => path.resolve(name)));
    const result = generateFrom(program, roots, { out: file, root });

    // Repeat diagnostics only when they change, not on every save.
    const report = result.diagnostics.map(formatDiagnostic).join('\n');
    if (report !== reported && report) console.log(report);
    reported = report;
    if (result.diagnostics.some((d) => d.severity === 'error')) return false;

    let current: string | undefined;
    try {
      current = readFileSync(file, 'utf8');
    } catch {
      current = undefined;
    }
    if (current !== undefined && sameContent(current, result.source)) return false;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, result.source);
    console.log(`${out} updated: ${String(result.routes.length)} routes`);
    return true;
  };
}
