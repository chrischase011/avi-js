// Copies the tutorial, the examples index and the brand assets into the site, so docs/tutorial
// stays the only source. Links that leave the tutorial point to GitHub.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const site = fileURLToPath(new URL('../src/', import.meta.url));
const repo = 'https://github.com/chrischase011/avi-js';

const tutorial = path.join(site, 'tutorial');
rmSync(tutorial, { recursive: true, force: true });
mkdirSync(tutorial, { recursive: true });
for (const file of readdirSync(path.join(root, 'docs/tutorial'))) {
  if (!file.endsWith('.md')) continue;
  const text = readFileSync(path.join(root, 'docs/tutorial', file), 'utf8').replaceAll(
    '](README.md)',
    '](index.md)',
  );
  writeFileSync(path.join(tutorial, file === 'README.md' ? 'index.md' : file), text);
}

const examples = readFileSync(path.join(root, 'examples/README.md'), 'utf8').replace(
  /\]\((?!https?:|#)([^)]+)\)/g,
  (_, target) => `](${repo}/tree/main/examples/${target})`,
);
writeFileSync(path.join(site, 'examples.md'), examples);

const assets = [
  ['brand/logo/avi-mark.svg', 'mark.svg'],
  ['brand/logo/avi-mark-dark.svg', 'mark-dark.svg'],
  ['brand/icons/favicon.ico', 'favicon.ico'],
  ['brand/icons/favicon.svg', 'favicon.svg'],
  ['brand/icons/apple-touch-icon.png', 'apple-touch-icon.png'],
  ['brand/icons/icon-512.png', 'icon-512.png'],
];
const assetDir = path.join(site, 'public');
mkdirSync(assetDir, { recursive: true });
for (const [from, to] of assets) copyFileSync(path.join(root, from), path.join(assetDir, to));

// Files served unchanged at the site root, such as search engine verification files.
const staticDir = path.join(root, 'web/static');
for (const file of readdirSync(staticDir)) {
  copyFileSync(path.join(staticDir, file), path.join(assetDir, file));
}

console.log('Synced the tutorial, examples and brand assets into web/src');
