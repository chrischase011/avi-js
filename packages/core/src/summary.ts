import type { AddressInfo } from 'node:net';
import { styleText } from 'node:util';

export type StartupStep = 'Dependency graph' | 'Providers' | 'Routes' | 'Manifest' | 'HTTP server';

/** What startup achieved, filled in step by step. */
export interface StartupReport {
  readonly version: string;
  modules?: number;
  graphValidated?: boolean;
  providers?: number;
  /** Variables across all `defineConfig` tokens, when the app has any. */
  configVariables?: number;
  routes?: readonly {
    readonly method: string;
    readonly path: string;
    readonly controller: string;
  }[];
  url?: string;
  durationMs: number;
  failure?: { readonly step: StartupStep; readonly message: string };
}

export function addressUrl({ address, port, family }: AddressInfo): string {
  const any = address === '0.0.0.0' || address === '::';
  const host = any ? 'localhost' : family === 'IPv6' ? `[${address}]` : address;
  return `http://${host}:${String(port)}`;
}

function ms(value: number): string {
  return value < 10 ? `${value.toFixed(1)} ms` : `${String(Math.round(value))} ms`;
}

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

type Style = Parameters<typeof styleText>[0];

/** The block printed to a terminal. `colors` follows the terminal, including NO_COLOR. */
export function formatSummary(report: StartupReport, listRoutes: boolean, colors: boolean): string {
  const paint = (style: Style, text: string) =>
    colors ? styleText(style, text, { validateStream: false }) : text;
  const ok = paint('green', '✓');
  const lines = [`${paint('bold', `AVI.JS ${report.version}`)} · Application bootstrap`, ''];
  if (report.modules !== undefined) lines.push(`${ok} ${plural(report.modules, 'module')} loaded`);
  if (report.graphValidated) lines.push(`${ok} Dependency graph validated`);
  if (report.providers) {
    lines.push(`${ok} ${plural(report.providers, 'provider')} resolved`);
  }
  if (report.configVariables !== undefined) {
    lines.push(`${ok} Config validated (${plural(report.configVariables, 'variable')})`);
  }
  if (report.routes) {
    lines.push(`${ok} ${plural(report.routes.length, 'route')} registered`);
    if (listRoutes) {
      const width = Math.max(0, ...report.routes.map((route) => route.path.length));
      for (const route of report.routes) {
        const method = paint('cyan', route.method.padEnd(7));
        lines.push(`    ${method} ${route.path.padEnd(width)}  ${paint('dim', route.controller)}`);
      }
    }
  }
  if (report.url) lines.push(`${ok} HTTP server ready on ${paint('cyan', report.url)}`);

  if (report.failure) {
    const [first = '', ...rest] = report.failure.message.split('\n');
    lines.push(`${paint('red', '✗')} ${report.failure.step}: ${first}`);
    for (const line of rest) lines.push(`  ${line}`);
    lines.push('', paint('red', `Startup failed after ${ms(report.durationMs)}`));
  } else {
    lines.push('', `Startup completed in ${paint('bold', ms(report.durationMs))}`);
  }
  return `\n${lines.join('\n')}\n\n`;
}

/** One line for logs that are not a terminal. */
export function summaryLine(report: StartupReport): string {
  const parts = [
    plural(report.modules ?? 0, 'module'),
    plural(report.providers ?? 0, 'provider'),
    plural(report.routes?.length ?? 0, 'route'),
  ];
  if (report.configVariables !== undefined) {
    parts.push(`config validated (${plural(report.configVariables, 'variable')})`);
  }
  return `Avi.js ${report.version} started in ${ms(report.durationMs)}: ${parts.join(', ')}, listening on ${report.url ?? '?'}`;
}

/** One line for logs when startup fails: the step and the reason, causes included. */
export function failureLine(report: StartupReport): string {
  const { step = 'Startup', message = '' } = report.failure ?? {};
  const reason = message.split('\n').join(': ');
  return `Avi.js ${report.version} failed to start after ${ms(report.durationMs)}: ${step}: ${reason}`;
}

/** Fields for a structured logger. */
export function summaryFields(report: StartupReport): Record<string, unknown> {
  return {
    version: report.version,
    modules: report.modules,
    providers: report.providers,
    routes: report.routes?.length,
    configVariables: report.configVariables,
    url: report.url,
    durationMs: Math.round(report.durationMs * 100) / 100,
  };
}
