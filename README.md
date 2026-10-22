<div align="center">

# Avi.js

**Structure without the overhead.**

A lightweight, TypeScript-first backend framework for Node.js, featuring NestJS-inspired modules, controllers, and dependency injection with optional decorators and no required `reflect-metadata`.

[![CI](https://github.com/chrischase011/avi-js/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischase011/avi-js/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.12-339933.svg)](package.json)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange.svg)](#try-it-now)

[Tutorial](docs/tutorial/README.md) · [Project structure](#project-structure) · [Why Avi.js](#why-avijs) · [Try it](#try-it-now)

</div>

---

> [!IMPORTANT]
> Avi.js is in early development and not on npm yet. Everything shown below works today in the
> workspace: both API styles, routing, modules and dependency injection, middleware and guards, safe
> errors, schema validation with any Standard Schema library, and graceful shutdown. Follow along,
> try it, and help shape it before 1.0.

## Two styles, one engine

Write controllers the way your team likes. Both styles turn into the same internal definitions
and run on the same engine, so they behave identically.

**Explicit**: plain objects and functions, no decorators.

```ts
import { createAvi, defineController } from '@avi/core';

const users = defineController({
  prefix: '/users',
  inject: [UsersService],
  routes: (users) => [
    { method: 'GET', path: '/', handler: () => users.findAll() },
    { method: 'GET', path: '/:id', handler: (ctx) => users.findOne(ctx.params.id) },
  ],
});

const app = createAvi();
app.register({ providers: [UsersService], controllers: [users] });
await app.listen(3000);
```

**Decorators**: familiar if you know NestJS, built on standard TC39 decorators.

```ts
import { Controller, Get, Module, AviFactory, type Context } from '@avi/core';

@Controller('/users')
class UsersController {
  static inject = [UsersService] as const;
  constructor(private readonly users: UsersService) {}

  @Get('/')
  findAll() {
    return this.users.findAll();
  }

  @Get('/:id')
  findOne(ctx: Context) {
    return this.users.findOne(ctx.params.id);
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
class AppModule {}

const app = await AviFactory.create(AppModule);
await app.listen(3000);
```

## Project structure

Avi.js ships two official templates. Start small and grow into modules when the app needs them:
both run on the same router, DI container and request pipeline.

<table>
<tr>
<th>Modular (default)</th>
<th>Minimal</th>
</tr>
<tr>
<td>

```text
src/
├── main.ts
├── app.module.ts
├── modules/
│   └── users/
│       ├── users.module.ts
│       ├── users.controller.ts
│       ├── users.service.ts
│       └── dto/
└── common/
```

</td>
<td>

```text
src/
├── main.ts
├── routes/
│   └── users.ts
└── services/
    └── users.ts
```

</td>
</tr>
<tr>
<td>Feature-first. Each feature owns its module, controller and service, written with
decorators. For larger APIs and teams.</td>
<td>Functional. Routes and services written with the explicit API, no modules or decorators
required. For small services and quick starts.</td>
</tr>
</table>

```sh
avi new my-api                     # modular
avi new my-api --template minimal  # minimal
```

Each generated project compiles, has passing tests and serves requests out of the box. The layouts
are conventions, never runtime requirements: Avi.js does not scan folders or care where files live,
so you can move from minimal to modular one feature at a time. The tutorial's
[project structure chapter](docs/tutorial/09-project-structure.md) walks through both.

## Why Avi.js

**No reflection, no magic.** Dependencies are declared, not guessed. There is no
`reflect-metadata`, no `emitDecoratorMetadata` and no `experimentalDecorators`. What you read is
what runs.

**Types that follow your wiring.** List a service's dependencies once and TypeScript infers the
rest. Swap two entries by mistake and the compiler tells you.

**Errors at startup, not in production.** Missing providers, invalid exports, dependency cycles
and conflicting routes stop the app before it listens, with a message that names the culprit.

**Safe by default.** Bounded request bodies, sanitized error responses, abort-aware handlers and
graceful shutdown are built in, not plugins.

**Small and modular.** The core runs on native `node:http`, with no Express or Fastify underneath.
DI, HTTP and the public API are separate packages with one-way dependencies.

**Measured, not claimed.** Performance work is driven by reproducible benchmarks against
`node:http`, Fastify, Hono and NestJS. Numbers get published with their methodology, or not at
all. The current local baselines and how to run them are in [benchmarks](benchmarks/README.md).

## Try it now

Avi.js is not on npm yet. Clone the workspace and run the full check suite:

```sh
git clone https://github.com/chrischase011/avi-js.git
cd avi-js
pnpm install
pnpm verify
```

You need Node.js 22.12+ and pnpm 12. Then run the examples or generate a project:

```sh
pnpm --filter @avi/example-modular-api start   # http://localhost:3000/users
pnpm avi new my-api --dir ../                  # the avi CLI, from the workspace
```

[Chapter 0 of the tutorial](docs/tutorial/00-getting-started.md) walks through the workspace, and
the [tutorial](docs/tutorial/README.md) covers everything from a first route to production.

## Packages

| Package           | Purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `@avi/core`       | The public API you import: app factory, modules, controllers |
| `@avi/di`         | Explicit, reflection-free dependency injection               |
| `@avi/http`       | Router, request pipeline and the native Node.js adapter      |
| `@avi/validation` | Standard Schema validation for routes                        |
| `@avi/compiler`   | Optional build-time checks and manifests (`avi-compile`)     |
| `@avi/testing`    | A test client with provider overrides                        |
| `@avi/openapi`    | OpenAPI 3.1 documents from routes and schemas                |
| `@avi/cli`        | `avi new`, `avi dev`, `avi check`, `avi manifest`            |

Package names are provisional until they are published.

## Compatibility

Checked in CI on every push:

| Area       | Supported                                                           |
| ---------- | ------------------------------------------------------------------- |
| Node.js    | 22.12+, 24, 26                                                      |
| Platforms  | Linux (Node 22, 24, 26), Windows and macOS (Node 24)                |
| TypeScript | 6.0 to compile apps; published types also checked against 7.0       |
| Modules    | ESM, and CommonJS through `require(esm)` (Node 22.12+)              |
| Decorators | TC39 standard decorators; `experimentalDecorators` is not supported |

The **Package artifacts** job packs every package, installs the tarballs into fresh npm projects
and checks ESM, CommonJS, TypeScript 6 and 7, and both `avi new` templates end to end. See
[SECURITY.md](SECURITY.md) for the security policy, [CHANGELOG.md](CHANGELOG.md) for changes and
[RELEASING.md](RELEASING.md) for how releases are made.

## Contributing

Ideas, questions and feedback on the API are welcome, especially now, while it is still easy to
change. Open an issue to discuss a design, or a pull request with tests for a fix.

Before you open a pull request:

```sh
pnpm verify
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), for example
`feat(http): add HEAD fallback`.

## License

[MIT](LICENSE) © [Christopher Robin Chase](https://github.com/chrischase011)
