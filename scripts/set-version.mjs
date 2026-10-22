// Sets one version on every package in packages/ (lockstep versioning).
// Usage: pnpm release:version 0.1.0
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: pnpm release:version <major.minor.patch[-prerelease]>');
  process.exit(2);
}

const packages = fileURLToPath(new URL('../packages', import.meta.url));
for (const name of readdirSync(packages)) {
  const file = path.join(packages, name, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const previous = pkg.version;
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name}: ${previous} -> ${version}`);
}
