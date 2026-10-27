<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logo/avi-horizontal-dark.svg">
  <img alt="Avi.js" src="brand/logo/avi-horizontal.svg" width="320">
</picture>

**Structure without the overhead.**

A lightweight, TypeScript-first backend framework for Node.js, featuring NestJS-inspired modules, controllers, and dependency injection with optional decorators and no required `reflect-metadata`.

[![CI](https://github.com/chrischase011/avi-js/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischase011/avi-js/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.12-339933.svg)](package.json)
[![npm](https://img.shields.io/npm/v/@avijs/core.svg)](https://www.npmjs.com/package/@avijs/core)
[![Status](https://img.shields.io/badge/status-1.0%20release%20candidate-blue.svg)](#try-it-now)

[Website](https://chrischase011.github.io/avi-js/) · [Tutorial](docs/tutorial/README.md) · [Project structure](#project-structure) · [Why Avi.js](#why-avijs) · [Try it](#try-it-now)

</div>

---

> [!IMPORTANT]
> Avi.js 1.0 is in its release candidate: `npm install @avijs/core@next`, or
> `npm create avi@next my-app`. Until 1.0.0 the API only gets fixes; see
> [Stability and versions](docs/tutorial/17-stability.md) for what 1.x promises. Try it, and
> report what gets in your way.

## Two styles, one engine

Write controllers the way your team likes. Both styles turn into the same internal definitions
and run on the same engine, so they behave identically.

**Explicit**: plain objects and functions, no decorators.

```ts
import { createAvi, defineController } from '@avijs/core';

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
import { Controller, Get, Module, AviFactory, type Context } from '@avijs/core';

@Controller('/users')
class UsersController {
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

`avi dev` reads `UsersController`'s constructor and writes its dependency list into
`src/inject.gen.ts`, plain code you can read. `static inject = [UsersService] as const` in the
class does the same by hand, and wins.

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
npm create avi@latest my-api                          # modular
npm create avi@latest my-api -- --template minimal    # minimal
```

Each generated project compiles, has passing tests and serves requests out of the box. The layouts
are conventions, never runtime requirements: Avi.js does not scan folders or care where files live,
so you can move from minimal to modular one feature at a time. The tutorial's
[project structure chapter](docs/tutorial/09-project-structure.md) walks through both.

## Why Avi.js

**Explicit by design.** Every class's dependencies exist as code, generated from its constructor
or written by you, so there is no need for `reflect-metadata`, `emitDecoratorMetadata` or
`experimentalDecorators`. What you read is what runs.

**Types that follow your wiring.** Write a dependency list yourself and TypeScript checks it
against the constructor: swap two entries by mistake and the compiler tells you.

**Catch configuration errors early.** Missing providers, invalid exports, dependency cycles, and
conflicting routes are detected during application initialization, before the server starts
accepting requests.

**Safe by default.** Bounded request bodies, sanitized error responses, abort-aware handlers and
graceful shutdown are built in, not plugins.

**Small and modular.** The core runs on native `node:http`, with no Express or Fastify underneath.
DI, HTTP and the public API are separate packages with one-way dependencies.

**Measured, not claimed.** Performance work is driven by reproducible benchmarks against
`node:http`, Fastify, Hono and NestJS. Numbers get published with their methodology, or not at
all. The current local baselines and how to run them are in [benchmarks](benchmarks/README.md).

## Try it now

Create a project (Node.js 22.12+):

```sh
npm create avi@latest my-api
cd my-api
npm install
npm run dev    # http://localhost:3000
```

Run `npm create avi@latest` without a name to be asked for the name and the template, or pass
`-- --template minimal` for the minimal one. `npx @avijs/cli new my-api` does the same. Until
1.0.0 is out, `@latest` is 0.x: use `npm create avi@next` for the release candidate.

Or add it to an existing project:

```sh
npm install @avijs/core
```

To work on Avi.js itself, see [CONTRIBUTING.md](CONTRIBUTING.md).

The [tutorial](docs/tutorial/README.md) covers everything from a first route to production. For complete apps, see the [examples](examples/README.md): CRUD with validation,
authentication with guards and roles, and Prisma with SQLite.

## Packages

| Package             | Purpose                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `@avijs/core`       | The public API you import: app factory, modules, controllers       |
| `@avijs/di`         | Explicit, reflection-free dependency injection                     |
| `@avijs/http`       | Router, request pipeline and the native Node.js adapter            |
| `@avijs/validation` | Standard Schema validation for routes                              |
| `@avijs/compiler`   | Generated dependency lists and typed client, build checks          |
| `@avijs/testing`    | A test client with provider overrides                              |
| `@avijs/client`     | A typed `fetch` client from your routes, for any frontend          |
| `@avijs/workers`    | `cluster()` on every core, and `runWorker()` for jobs              |
| `@avijs/openapi`    | OpenAPI 3.1 documents from routes and schemas                      |
| `@avijs/security`   | CORS, security headers and rate limits                             |
| `@avijs/multipart`  | Streaming file uploads with limits                                 |
| `@avijs/cli`        | `avi new`, `generate`, `dev`, `build`, `check`, `client`, `inject` |

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
`feat(http): add HEAD fallback`. [CONTRIBUTING.md](CONTRIBUTING.md) covers the development setup,
repository layout, code style and the pull request process.

## License

[MIT](LICENSE) © [Christopher Robin Chase](https://github.com/chrischase011)
