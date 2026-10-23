// Load-tests servers with autocannon in interleaved rounds and prints the median and range.
import { execFileSync, fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import autocannon from 'autocannon';
import { ORDER, TOKEN, USER } from './data.js';

const DURATION = Number(process.env['BENCH_DURATION'] ?? 10);
const WARMUP = Number(process.env['BENCH_WARMUP'] ?? 3);
const ROUNDS = Number(process.env['BENCH_ROUNDS'] ?? 5);
const CONNECTIONS = Number(process.env['BENCH_CONNECTIONS'] ?? 100);
const PIN = process.env['BENCH_PIN'] !== '0';
// A round is dropped when node:http falls this far below its own median: the machine was busy.
const CANARY_DROP = 0.15;

interface Case {
  name: string;
  path: string;
  servers: readonly string[];
  body?: string;
  headers?: Record<string, string>;
}

// Server name → compiled file in servers/ and its extra arguments.
const SERVERS: Record<string, [file: string, ...args: string[]]> = {
  node: ['node'],
  avi: ['avi'],
  'avi-defaults': ['avi', 'defaults'],
  fastify: ['fastify'],
  hono: ['hono'],
  'nest-express': ['nest', 'express'],
  'nest-fastify': ['nest', 'fastify'],
  // From `pnpm bench:baseline`: the build before a change, for A/B runs.
  baseline: ['../../results/baseline/servers/avi'],
};
const COMPARED = ['node', 'avi', 'fastify', 'hono', 'nest-express', 'nest-fastify', 'baseline'];
const ONLY = process.env['BENCH_SERVERS']?.split(',');
const ONLY_CASES = process.env['BENCH_CASES']?.split(',');

const AUTH = { authorization: TOKEN };
const CASES: readonly Case[] = [
  { name: 'hello', path: '/', servers: [...COMPARED, 'avi-defaults'] },
  { name: 'param', path: '/users/123', servers: COMPARED },
  { name: 'list', path: '/list', servers: COMPARED },
  { name: 'echo', path: '/echo', servers: COMPARED, body: USER },
  { name: 'orders', path: '/orders', servers: COMPARED, body: ORDER, headers: AUTH },
  // Compare with avi on echo: the same body without a schema.
  { name: 'validated', path: '/validated', servers: ['avi', 'baseline'], body: USER },
];

interface Server {
  name: string;
  port: number;
  pid: number;
  /** User + system CPU time the server process has used, in microseconds. */
  cpu(): Promise<number>;
  stop(): Promise<void>;
}

async function startServer(name: string): Promise<Server> {
  const [file, ...args] = SERVERS[name] ?? [name];
  const child = fork(new URL(`./servers/${file}.js`, import.meta.url), ['0', ...args], {
    stdio: 'inherit',
    execArgv: ['--import', new URL('./servers/probe.js', import.meta.url).href],
  });
  const port = await new Promise<number>((resolve, reject) => {
    child.once('message', (message) => {
      resolve((message as { port: number }).port);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      reject(new Error(`${name} server exited with ${String(code)}`));
    });
  });
  return {
    name,
    port,
    pid: child.pid ?? 0,
    cpu: () =>
      new Promise<number>((resolve) => {
        const onMessage = (message: unknown) => {
          const usage = (message as { cpu?: { user: number; system: number } }).cpu;
          if (!usage) return;
          child.off('message', onMessage);
          resolve(usage.user + usage.system);
        };
        child.on('message', onMessage);
        child.send('cpu');
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        child.removeAllListeners('exit');
        child.once('exit', () => {
          resolve();
        });
        child.disconnect();
      }),
  };
}

/** Servers get the first half of the CPUs, the load generator the rest. */
function pin(pid: number, half: 'low' | 'high'): void {
  const count = cpus().length;
  const low = (1n << BigInt(Math.floor(count / 2))) - 1n;
  const mask = half === 'low' ? low : ((1n << BigInt(count)) - 1n) & ~low;
  try {
    if (platform() === 'win32') {
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `(Get-Process -Id ${String(pid)}).ProcessorAffinity = ${mask.toString()}`,
      ]);
    } else if (platform() === 'linux') {
      execFileSync('taskset', ['-a', '-p', mask.toString(16), String(pid)], { stdio: 'ignore' });
    }
  } catch {
    console.warn(`Could not pin process ${String(pid)}; running unpinned`);
  }
}

function load(port: number, c: Case, duration: number) {
  return autocannon({
    url: `http://127.0.0.1:${String(port)}${c.path}`,
    connections: CONNECTIONS,
    duration,
    pipelining: 1,
    ...(c.body === undefined
      ? {}
      : {
          method: 'POST' as const,
          body: c.body,
          headers: { 'content-type': 'application/json', ...c.headers },
        }),
  });
}

/** Every server must answer like node:http, or the comparison is not fair. */
async function checkResponses(c: Case, servers: readonly Server[]): Promise<void> {
  const answer = async (port: number) => {
    const res = await fetch(`http://127.0.0.1:${String(port)}${c.path}`, {
      method: c.body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...c.headers },
      ...(c.body === undefined ? {} : { body: c.body }),
    });
    const body = await res.json();
    return JSON.stringify([res.status, body, res.headers.get('location')]);
  };
  const reference = servers.find((s) => s.name === 'node') ?? servers[0];
  if (!reference) return;
  const expected = await answer(reference.port);
  for (const server of servers) {
    const actual = await answer(server.port);
    if (actual !== expected) {
      throw new Error(`${server.name} answers ${c.name} differently:\n${actual}\n${expected}`);
    }
  }
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

interface Sample {
  round: number;
  rps: number;
  /** Server CPU microseconds per request. */
  cpu: number;
  p50: number;
  p99: number;
  errors: number;
}

interface Row {
  case: string;
  server: string;
  rps: number;
  cpu: number;
  min: number;
  max: number;
  p50: number;
  p99: number;
  rounds: number;
  errors: number;
}

const machine = {
  date: new Date().toISOString(),
  node: process.version,
  os: `${platform()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model.trim() ?? 'unknown',
  cpus: cpus().length,
  memoryGb: Math.round(totalmem() / 2 ** 30),
  commit: git(['rev-parse', '--short', 'HEAD']),
  dirty: git(['status', '--porcelain']) !== '',
  settings: { DURATION, WARMUP, ROUNDS, CONNECTIONS, PIN },
};

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

console.log(`${machine.cpu} (${String(machine.cpus)} CPUs), Node ${machine.node}, ${machine.os}`);
console.log(
  `${String(CONNECTIONS)} connections, ${String(WARMUP)} s warm-up, ${String(ROUNDS)} rounds × ${String(DURATION)} s, servers in random order each round${PIN ? ', pinned' : ''}\n`,
);
if (PIN) pin(process.pid, 'high');

const rows: Row[] = [];
const notes: string[] = [];

for (const c of CASES.filter((x) => !ONLY_CASES || ONLY_CASES.includes(x.name))) {
  const names = c.servers.filter((s) => (ONLY ? ONLY.includes(s) : s !== 'baseline'));
  const servers: Server[] = [];
  for (const name of names) servers.push(await startServer(name));
  try {
    if (PIN) for (const server of servers) pin(server.pid, 'low');
    await checkResponses(c, servers);
    for (const server of servers) await load(server.port, c, WARMUP);

    const samples = new Map<string, Sample[]>(names.map((n) => [n, []]));
    for (let round = 1; round <= ROUNDS; round++) {
      for (const server of shuffle(servers)) {
        const before = await server.cpu();
        const r = await load(server.port, c, DURATION);
        const used = (await server.cpu()) - before;
        samples.get(server.name)?.push({
          round,
          rps: r.requests.average,
          cpu: used / Math.max(1, r.requests.total),
          p50: r.latency.p50,
          p99: r.latency.p99,
          errors: r.errors + r.non2xx,
        });
      }
      process.stdout.write(`${c.name}: round ${String(round)}/${String(ROUNDS)}\r`);
    }

    const canary = samples.get('node');
    const dropped = new Set<number>();
    if (canary) {
      const typical = median(canary.map((s) => s.rps));
      for (const s of canary) if (s.rps < typical * (1 - CANARY_DROP)) dropped.add(s.round);
      if (dropped.size > 0) {
        notes.push(
          `${c.name}: dropped round ${[...dropped].join(', ')} (node:http more than ${String(CANARY_DROP * 100)}% below its median)`,
        );
      }
    }

    for (const [server, all] of samples) {
      const kept = all.filter((s) => !dropped.has(s.round));
      const rps = kept.map((s) => s.rps);
      rows.push({
        case: c.name,
        server,
        rps: Math.round(median(rps)),
        cpu: Math.round(median(kept.map((s) => s.cpu)) * 10) / 10,
        min: Math.round(Math.min(...rps)),
        max: Math.round(Math.max(...rps)),
        p50: median(kept.map((s) => s.p50)),
        p99: median(kept.map((s) => s.p99)),
        rounds: kept.length,
        errors: all.reduce((sum, s) => sum + s.errors, 0),
      });
    }
    console.log(`${c.name}: done${' '.repeat(20)}`);
  } finally {
    await Promise.all(servers.map((s) => s.stop()));
  }
}

// Ranges that overlap show no difference, whatever the medians say.
for (const row of rows.filter((r) => r.server === 'avi')) {
  const base = rows.find((r) => r.case === row.case && r.server === 'baseline');
  if (base) {
    const change = ((row.cpu - base.cpu) / base.cpu) * 100;
    notes.push(
      `${row.case}: CPU per request ${String(base.cpu)} → ${String(row.cpu)} µs (${change > 0 ? '+' : ''}${change.toFixed(1)}%) vs baseline`,
    );
  }
  for (const other of rows.filter((r) => r.case === row.case && r.server !== 'avi')) {
    if (row.min <= other.max && other.min <= row.max) {
      notes.push(`${row.case}: avi and ${other.server} overlap; no difference shown`);
    }
  }
}

console.log();
console.table(
  rows.map((r) => ({
    case: r.case,
    server: r.server,
    'req/s': r.rps,
    range: `${String(r.min)}–${String(r.max)}`,
    'CPU µs/req': r.cpu,
    'p50 ms': r.p50,
    'p99 ms': r.p99,
    rounds: r.rounds,
    errors: r.errors,
  })),
);
for (const note of notes) console.log(`note: ${note}`);

const dir = new URL('../results/', import.meta.url);
mkdirSync(dir, { recursive: true });
const file = new URL(`http-${machine.date.replace(/[:.]/g, '-')}.json`, dir);
writeFileSync(file, `${JSON.stringify({ machine, rows, notes }, null, 2)}\n`);
console.log(`\nSaved ${file.pathname}`);
