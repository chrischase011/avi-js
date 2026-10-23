// Saves the current build as the A/B baseline: `pnpm bench:baseline`, change code, rebuild, then
// `BENCH_SERVERS=baseline,avi pnpm bench:http` compares the two in the same interleaved run.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = fileURLToPath(new URL('../results/baseline/', import.meta.url));
rmSync(out, { recursive: true, force: true });

// The server files, plus a node_modules that shadows the workspace packages with their dist.
for (const file of ['servers/avi.js', 'servers/probe.js', 'data.js', 'routes.js']) {
  cpSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), `${out}${file}`);
}
for (const name of ['di', 'http', 'validation', 'core']) {
  const to = `${out}node_modules/@avijs/${name}/`;
  mkdirSync(to, { recursive: true });
  cpSync(`${root}packages/${name}/dist`, `${to}dist`, { recursive: true });
  cpSync(`${root}packages/${name}/package.json`, `${to}package.json`);
}
console.log(`Saved the current build as the baseline in ${out}`);
