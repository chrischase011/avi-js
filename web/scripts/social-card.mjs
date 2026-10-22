// Renders web/static/social.png (1200×630), the link preview image, with headless Chrome.
// Run after changing the logo or tagline: node web/scripts/social-card.mjs
// Set CHROME to the browser binary if it is not in the default place.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const logo = readFileSync(path.join(root, 'brand/logo/avi-horizontal-dark.svg'), 'utf8');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body {
    background: radial-gradient(circle at 82% 20%, #0f766e66, transparent 55%), #0b1220;
    color: #f1f5f9; font-family: 'Segoe UI', Inter, system-ui, sans-serif;
    display: flex; flex-direction: column; justify-content: center; padding: 0 96px;
    box-sizing: border-box;
  }
  .logo svg { width: 420px; height: auto; display: block; margin-left: -8px; }
  h1 { font-size: 64px; line-height: 1.1; margin: 44px 0 18px; font-weight: 700; letter-spacing: -1px; }
  p { font-size: 30px; line-height: 1.35; margin: 0; color: #94a3b8; max-width: 900px; }
  footer { position: absolute; left: 96px; right: 96px; bottom: 56px; display: flex;
    justify-content: space-between; align-items: center; font-size: 26px; color: #94a3b8; }
  code { font-family: 'Cascadia Code', Consolas, monospace; color: #2dd4bf;
    background: #2dd4bf1a; border: 1px solid #2dd4bf55; border-radius: 10px; padding: 8px 18px; }
</style></head><body>
  <div class="logo">${logo}</div>
  <h1>Structure without the overhead.</h1>
  <p>A TypeScript framework for Node.js with modules, controllers and dependency injection.</p>
  <footer><code>npm create avi@latest</code><span>chrischase011.github.io/avi-js</span></footer>
</body></html>`;

const work = mkdtempSync(path.join(tmpdir(), 'avi-card-'));
const page = path.join(work, 'card.html');
writeFileSync(page, html);
const out = path.join(root, 'web/static/social.png');
const chrome =
  process.env['CHROME'] ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : 'google-chrome');
const result = spawnSync(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,630',
    `--screenshot=${out}`,
    pathToFileURL(page).href,
  ],
  { encoding: 'utf8' },
);
rmSync(work, { recursive: true, force: true });
if (result.status !== 0) {
  console.error(result.error ?? result.stderr);
  process.exit(1);
}
console.log(`Wrote ${path.relative(root, out)}`);
