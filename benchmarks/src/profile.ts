// Profiles the Avi server under load and prints where the time goes.
// Usage: pnpm bench:profile <case> [seconds]; BENCH_DEFAULTS=1 keeps request ids on.
import { fork } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';
import { ORDER, TOKEN, USER } from './data.js';

const CASES: Record<string, { path: string; body?: string; headers?: Record<string, string> }> = {
  hello: { path: '/' },
  param: { path: '/users/123' },
  list: { path: '/list' },
  echo: { path: '/echo', body: USER },
  orders: { path: '/orders', body: ORDER, headers: { authorization: TOKEN } },
  validated: { path: '/validated', body: USER },
};

const name = process.argv[2] ?? 'echo';
const seconds = Number(process.argv[3] ?? 10);
const c = CASES[name];
if (!c) {
  console.error(`Unknown case ${name}. Cases: ${Object.keys(CASES).join(', ')}`);
  process.exit(2);
}

const dir = fileURLToPath(new URL(`../results/profile-${name}/`, import.meta.url));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const child = fork(
  new URL('./servers/avi.js', import.meta.url),
  ['0', process.env['BENCH_DEFAULTS'] ? 'defaults' : ''],
  { execArgv: ['--cpu-prof', `--cpu-prof-dir=${dir}`], stdio: 'inherit' },
);
const port = await new Promise<number>((resolve) => {
  child.once('message', (m) => {
    resolve((m as { port: number }).port);
  });
});

const run = (duration: number) =>
  autocannon({
    url: `http://127.0.0.1:${String(port)}${c.path}`,
    connections: 100,
    duration,
    ...(c.body === undefined
      ? {}
      : {
          method: 'POST' as const,
          body: c.body,
          headers: { 'content-type': 'application/json', ...c.headers },
        }),
  });

await run(2);
const result = await run(seconds);
const exited = new Promise((resolve) => child.once('exit', resolve));
child.disconnect();
await exited;

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
}
interface Profile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}

const file = readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
if (!file) throw new Error(`No profile written to ${dir}`);
const profile = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as Profile;

const byNode = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map<string, number>();
const areas = new Map<string, number>();
let total = 0;
profile.samples.forEach((id, i) => {
  const frame = byNode.get(id)?.callFrame;
  const time = profile.timeDeltas[i] ?? 0;
  if (!frame || frame.functionName === '(idle)') return;
  total += time;
  const where = frame.url ? `${short(frame.url)}:${String(frame.lineNumber + 1)}` : '';
  const key = `${frame.functionName || '(anonymous)'} ${where}`.trim();
  self.set(key, (self.get(key) ?? 0) + time);
  const area = areaOf(frame);
  areas.set(area, (areas.get(area) ?? 0) + time);
});

function short(url: string): string {
  const match = /packages\/([^/]+)\/(?:dist|src)\/(.+)$/.exec(url.replaceAll('\\', '/'));
  if (match) return `@avijs/${match[1] ?? ''}/${match[2] ?? ''}`;
  return url.replace(/^.*node_modules\//, '').replace(/^file:\/\/\/.*\//, '');
}

function areaOf(frame: ProfileNode['callFrame']): string {
  if (frame.functionName === '(garbage collector)') return 'garbage collection';
  if (frame.functionName === '(program)') return 'V8 / native';
  const avi = /packages\/([^/]+)\//.exec(frame.url.replaceAll('\\', '/'));
  if (avi) return `@avijs/${avi[1] ?? ''}`;
  if (frame.url.startsWith('node:')) return 'Node.js (http, streams, net)';
  if (frame.url === '') return 'V8 / native';
  return 'other';
}

const pct = (t: number) => `${((t / total) * 100).toFixed(1)}%`;
console.log(
  `\n${name}: ${String(Math.round(result.requests.average))} req/s while profiling (profiling slows it down)\n`,
);
console.log('By area:');
for (const [area, t] of [...areas].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pct(t).padStart(6)}  ${area}`);
}
console.log('\nTop functions by self time:');
for (const [fn, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${pct(t).padStart(6)}  ${fn}`);
}
console.log(`\nProfile: ${path.join(dir, file)} (open in Chrome DevTools, Performance tab)`);
