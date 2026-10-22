# Contributing to Avi.js

Thanks for helping. Bug reports, design discussions, docs fixes and code are all welcome. For
anything bigger than a small fix, open an issue first so we can agree on the approach before you
spend time on it.

## Development setup

### Requirements

- **Node.js 22.12 or newer** (24 recommended). Check with `node --version`.
- **pnpm 12.** Install it with `npm install -g pnpm@12`, or see [pnpm.io/installation](https://pnpm.io/installation).
  The exact version is pinned in `package.json` under `packageManager`.
- **Git.**

### First run

```sh
git clone https://github.com/chrischase011/avi-js.git
cd avi-js
pnpm install
pnpm verify
```

`pnpm verify` runs everything CI runs, in order: format check, lint, typecheck, build, tests and the
example apps. If it passes, your setup is ready.

### Day-to-day commands

| Command                                            | What it does                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm test:watch`                                  | Runs tests on every change. Tests use package sources, no build needed |
| `pnpm test`                                        | Runs all tests once (Vitest: `*.test.ts` and type tests `*.test-d.ts`) |
| `pnpm typecheck`                                   | Type-checks every package, including tests                             |
| `pnpm lint`                                        | ESLint with type-aware rules                                           |
| `pnpm format`                                      | Formats everything with Prettier (`format:check` only checks)          |
| `pnpm build`                                       | Builds every package into `dist/` with `tsc -b`                        |
| `pnpm examples`                                    | Runs the example apps' smoke checks against the build                  |
| `pnpm verify`                                      | All of the above, as CI does                                           |
| `pnpm verify:artifacts`                            | Packs the packages and tests them as an npm user would (needs network) |
| `pnpm avi <command>`                               | Runs the `avi` CLI from the workspace, e.g. `pnpm avi new my-api`      |
| `pnpm bench:router`, `bench:http`, `bench:startup` | Local benchmarks, see `benchmarks/README.md`                           |

### Editor

Use the workspace TypeScript version (6.0.x). In VS Code: _TypeScript: Select TypeScript Version →
Use Workspace Version_. Prettier and ESLint configs are at the repository root.

## Repository layout

```text
packages/
  core/         @avijs/core: public API (createAvi, modules, controllers, decorators)
  di/           @avijs/di: dependency injection container
  http/         @avijs/http: router, request context, pipeline, node:http server
  validation/   @avijs/validation: Standard Schema validation
  compiler/     @avijs/compiler: avi-compile check and manifest
  testing/      @avijs/testing: test client
  openapi/      @avijs/openapi: OpenAPI documents
  security/     @avijs/security: CORS and security headers
  cli/          @avijs/cli: the avi command and project templates
examples/       apps built from the published entry points
benchmarks/     router, HTTP and startup benchmarks
docs/tutorial/  the tutorial
scripts/        release and artifact tooling
```

Each package has `src/`, `test/`, a `tsconfig.json` (editor, lint, typecheck) and a
`tsconfig.build.json` (build). Import other packages only through their entry point
(`@avijs/http`), never through deep paths. `di` and `http` must not depend on each other; only `core`
connects them.

## Making a change

1. **Create a branch** from `main`.
2. **Write the test first** for a bug fix, so it fails before your fix and passes after.
3. **Keep changes focused.** One concern per pull request is easier to review.
4. **Update the docs** when behavior changes: the matching tutorial chapter in `docs/tutorial/`,
   and `CHANGELOG.md` under "Unreleased".
5. **Public API changes** need extra care. Each package pins its runtime exports in
   `test/public-api.test.ts`; update it deliberately and describe the change in `CHANGELOG.md`.
   Mark breaking changes clearly.
6. **Run `pnpm verify`** before pushing.

## Code style

- Strict TypeScript, ESM only. Avoid `any`; prefer `unknown` and narrow it.
- Standard (TC39) decorators only. Never add `reflect-metadata` or rely on `emitDecoratorMetadata`.
- Keep comments short and useful: explain why, not what. No large comment blocks.
- Don't add runtime dependencies to the framework packages without discussing it first. Dev
  dependencies should be pinned to exact versions.
- Error messages should say what went wrong and how to fix it, naming the module, token or route.

## Tests

- Unit and integration tests live in `packages/*/test/*.test.ts`; type tests in `*.test-d.ts`.
- HTTP tests start a real server on port 0 and use `fetch`; see `packages/http/test/helpers.ts`.
- Decorators in tests are compiled with `tsc` through a small Vitest plugin in `vitest.config.ts`,
  because Vite's own transform does not support standard decorators yet.
- Tests must pass on Linux, macOS and Windows. On Windows, keep concurrent connection tests under
  about 150 connections (the OS listen backlog).

## Performance

Measure, don't guess. Changes made for speed need a before/after measurement on the same machine,
ideally an A/B in one process as described in `benchmarks/README.md`. Never claim Avi.js is faster
than another framework without a reproducible benchmark.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
- Scope is the package or area when it helps: `feat(http): ...`, `docs(tutorial): ...`.
- Summary under 50 characters, imperative mood, lowercase, no period: `fix header precedence`.
- Use the body to explain what and why, wrapped at 72 characters.
- Credit people only: don't add `Co-authored-by` trailers or signatures for tools or bots.

## Pull requests

- Describe what changed and why, and link the issue.
- Make sure CI is green, including the package artifact and audit jobs.
- A maintainer will review it. Feedback is about the code, never the person.

## Security

Please don't report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
