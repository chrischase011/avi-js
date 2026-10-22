import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { defineConfig, type Plugin } from 'vitest/config';

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

// Vite's built-in transform does not lower standard decorators yet, so compile
// workspace TypeScript with tsc, matching the published build output.
const typescript: Plugin = {
  name: 'avi:typescript',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('.ts') || id.includes('/node_modules/')) return null;
    const out = ts.transpileModule(code, {
      fileName: id,
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
        sourceMap: true,
        inlineSources: true,
      },
    });
    return { code: out.outputText, map: out.sourceMapText ?? null };
  },
};

export default defineConfig({
  plugins: [typescript],
  resolve: {
    alias: {
      '@avijs/cli': src('cli'),
      '@avijs/compiler': src('compiler'),
      '@avijs/core': src('core'),
      '@avijs/di': src('di'),
      '@avijs/http': src('http'),
      '@avijs/openapi': src('openapi'),
      '@avijs/security': src('security'),
      '@avijs/testing': src('testing'),
      '@avijs/validation': src('validation'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // The memory-stability test forces garbage collection.
    execArgv: ['--expose-gc'],
    typecheck: {
      enabled: true,
      include: ['packages/*/test/**/*.test-d.ts'],
      tsconfig: './tsconfig.test.json',
    },
  },
});
