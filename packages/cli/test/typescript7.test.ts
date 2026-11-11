import { expect, it, vi } from 'vitest';
import { main } from '../src/index.js';

// What TypeScript 7 (the native port) exports: npx installs it when the project has none.
vi.mock('typescript', () => ({ default: { version: '7.0.2', versionMajorMinor: '7.0' } }));

it('refuses a TypeScript without the compiler API in one line', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    for (const command of ['g', 'build', 'dev', 'check', 'client', 'inject']) {
      expect(await main([command, 'controller', 'posts'])).toBe(1);
      expect(String(error.mock.lastCall?.[0])).toBe(
        'Avi.js needs TypeScript 5.8 to 6.x, found 7.0.2, which has no compiler API. Run npm install in the project, or install typescript@~6.0.',
      );
    }
    // Commands without TypeScript still work.
    expect(await main(['--version'])).toBe(0);
  } finally {
    error.mockRestore();
  }
});
