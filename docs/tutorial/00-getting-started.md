# 0. Getting started with the workspace

> **Status: Runnable.** Everything on this page works today.

Avi.js is not published to npm yet. To try it, you work inside the repository. This chapter gets
the workspace running, shows you around, and ends with a small exercise against the type
contracts that already exist.

## Prerequisites

- **Node.js 22.12 or newer.** Check with `node --version`.
- **pnpm 12.** See [pnpm.io/installation](https://pnpm.io/installation). The exact version is
  pinned in `package.json` under `packageManager`.
- Git.

## Install and verify

```sh
git clone https://github.com/chrischase011/avi-js.git
cd avi-js
pnpm install
pnpm verify
```

`pnpm verify` runs the same checks as CI, in order:

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `pnpm format:check` | Prettier, without writing changes (`pnpm format` fixes formatting) |
| `pnpm lint`         | ESLint with type-aware `typescript-eslint` rules                   |
| `pnpm typecheck`    | `tsc` on every package, including tests                            |
| `pnpm build`        | `tsc -b`: emits `dist/` with `.d.ts` files for each package        |
| `pnpm test`         | Vitest: runtime tests (`*.test.ts`) and type tests (`*.test-d.ts`) |
| `pnpm examples`     | Runs each example against the built packages                       |

When it finishes, the last line comes from the example:

```text
basic-api smoke check passed
```

That check starts the example app from its build output, sends real HTTP requests and shuts it
down, exactly as an app will use Avi.js after it is published.

## A tour of the workspace

```text
avi-js/
├── packages/
│   ├── core/      @avi/core: the public API you import
│   ├── di/        @avi/di: dependency injection
│   └── http/      @avi/http: router, pipeline, Node.js adapter
├── examples/
│   └── basic-api/ an app that consumes the built packages
├── docs/          you are here
├── tsconfig.base.json
├── vitest.config.ts
└── eslint.config.js
```

Each package has the same shape:

```text
packages/di/
├── src/index.ts          the public entry point; anything not exported here is internal
├── test/                 *.test.ts and *.test-d.ts
├── tsconfig.json         editor, lint and typecheck (includes tests, no output)
├── tsconfig.build.json   build only (src → dist)
└── package.json
```

Two things to know:

- **You import only from `@avi/core`.** It re-exports what applications need from `di` and
  `http`. The other packages exist to keep the internals decoupled.
- **Tests do not need a build.** Vitest maps `@avi/*` to each package's `src/`, so
  `pnpm test:watch` gives instant feedback while you edit.

## Exercise: put the DI types to work

Dependency injection is not implemented yet, but its type contract is. In Avi.js you list a
class's dependencies explicitly, and TypeScript infers what each one resolves to. Try it.

Create `packages/di/test/playground.test-d.ts`:

```ts
import { expectTypeOf, it } from 'vitest';
import type { InjectionToken, ResolveTokens } from '../src/index.js';

class UsersRepository {
  findAll() {
    return [{ id: 1, name: 'Ada' }];
  }
}

interface AppConfig {
  greeting: string;
}

declare const Config: InjectionToken<AppConfig>;

it('resolves an inject list in order', () => {
  type Deps = ResolveTokens<[typeof UsersRepository, typeof Config]>;
  expectTypeOf<Deps>().toEqualTypeOf<[UsersRepository, AppConfig]>();
});
```

Run it:

```sh
pnpm test
```

Now swap the order in the expected tuple to `[AppConfig, UsersRepository]` and run again. The
type test fails. This is how Avi.js will catch a mismatch between what a service declares in
`inject` and what its constructor expects.

Delete the playground file when you are done.

## Next

[Chapter 1: Your first app](01-first-app.md) shows the HTTP API that Phase 1 delivers.
