// Load-tests each server in its own process with autocannon and prints median results.
import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import autocannon from 'autocannon';

const DURATION = Number(process.env['BENCH_DURATION'] ?? 10);
const WARMUP = Number(process.env['BENCH_WARMUP'] ?? 3);
const RUNS = Number(process.env['BENCH_RUNS'] ?? 3);
const CONNECTIONS = Number(process.env['BENCH_CONNECTIONS'] ?? 100);

const SERVERS = ['node', 'avi'] as const;
const CASES = [
  ['JSON hello', '/'],
  ['JSON with param', '/users/123'],
] as const;

interface Row {
  server: string;
  case: string;
  rps: number;
  p50: number;
  p90: number;
  p99: number;
  errors: number;
}

async function startServer(name: string) {
  const child = fork(new URL(`./servers/${name}.js`, import.meta.url), [], { stdio: 'inherit' });
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
    port,
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

function load(url: string, duration: number) {
  return autocannon({ url, connections: CONNECTIONS, duration, pipelining: 1 });
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

console.log(
  `Node ${process.version}, ${String(cpus().length)} CPUs (${cpus()[0]?.model ?? 'unknown'})`,
);
console.log(
  `${String(CONNECTIONS)} connections, ${String(WARMUP)}s warm-up, ${String(RUNS)} × ${String(DURATION)}s runs, median reported\n`,
);

const rows: Row[] = [];
for (const [caseName, path] of CASES) {
  for (const name of SERVERS) {
    const server = await startServer(name);
    const url = `http://127.0.0.1:${String(server.port)}${path}`;
    await load(url, WARMUP);

    const results = [];
    for (let i = 0; i < RUNS; i++) results.push(await load(url, DURATION));
    await server.stop();

    rows.push({
      server: name,
      case: caseName,
      rps: Math.round(median(results.map((r) => r.requests.average))),
      p50: median(results.map((r) => r.latency.p50)),
      p90: median(results.map((r) => r.latency.p90)),
      p99: median(results.map((r) => r.latency.p99)),
      errors: results.reduce((sum, r) => sum + r.errors + r.non2xx, 0),
    });
    console.log(`done: ${caseName} / ${name}`);
  }
}

console.log();
console.table(rows);
