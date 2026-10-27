# 0. Getting started

> **Status: Runnable.** Everything on this page works with the packages on npm.

This chapter creates an Avi.js project with `npm create avi`, tours the generated files and adds
a feature with the CLI.

You need **Node.js 22.12 or newer**. Check with `node --version`.

## Create a project

```sh
npm create avi@latest my-api
cd my-api
npm install
npm run dev
```

```text
AVI.JS 1.0.0 · Application bootstrap

✓ 3 modules loaded
✓ Dependency graph validated
✓ 2 providers resolved
✓ Config validated (1 variable)
✓ 4 routes registered
✓ HTTP server ready on http://localhost:3000

Startup completed in 5.3 ms
```

That summary lists what Avi.js checked before accepting requests ([chapter 7](07-production.md#startup-summary)).
Open http://localhost:3000/users. `npm run dev` recompiles and restarts on every change.

Without a name, `npm create avi@latest` asks for the name, the template and the validation
library (Valibot by default). There are two templates:

| Template          | Command                                              | For                         |
| ----------------- | ---------------------------------------------------- | --------------------------- |
| modular (default) | `npm create avi@latest my-api`                       | Feature modules, decorators |
| minimal           | `npm create avi@latest my-api -- --template minimal` | Plain routes and services   |

Both run on the same engine; [chapter 9](09-project-structure.md) compares them.

## What you get

The modular template:

```text
my-api/
├── src/
│   ├── main.ts                    starts the app
│   ├── app.module.ts              the root module
│   ├── config.ts                  environment variables, validated at startup (with a validator)
│   ├── api.gen.ts                 the typed Api for @avijs/client, kept current by avi dev
│   ├── inject.gen.ts              dependency lists inferred from constructors, by avi dev
│   ├── common/
│   │   └── health.controller.ts   GET /health
│   └── modules/users/
│       ├── users.module.ts
│       ├── users.controller.ts    GET /users, GET /users/:id, POST /users
│       ├── users.service.ts
│       ├── users.test.ts
│       └── dto/user.dto.ts        Valibot schemas for input and responses
├── package.json
└── tsconfig.json
```

| Script          | What it does                                                                        |
| --------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`   | Compile, then recompile and restart on every change; keeps `src/api.gen.ts` current |
| `npm test`      | Compile and run the tests with `node --test`                                        |
| `npm run build` | `avi build`: update `src/api.gen.ts`, empty `dist/`, compile into it                |
| `npm start`     | Run the compiled app                                                                |
| `npm run check` | Check every `static inject` list against its class                                  |

## Add a feature

The CLI creates files and registers them for you. One command gives you a module, a service and a
controller with working CRUD routes:

```sh
npx avi g resource posts
```

http://localhost:3000/posts now lists, creates, updates and deletes posts, kept in memory until you
connect a database.

Instead of a resource, you can create the pieces one at a time and write the routes yourself:

```sh
npx avi g module posts
npx avi g service posts
npx avi g controller posts
```

```text
CREATE src/modules/posts/posts.module.ts
UPDATE src/app.module.ts
CREATE src/modules/posts/posts.service.ts
UPDATE src/modules/posts/posts.module.ts
CREATE src/modules/posts/posts.controller.ts
UPDATE src/modules/posts/posts.module.ts
UPDATE src/inject.gen.ts
```

`npm run dev` picks the change up, and http://localhost:3000/posts answers `[]`. The controller
injects the service it found next to it:

```ts
@Controller('/posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  findAll() {
    return this.posts.findAll();
  }
}
```

Nothing says what to inject: `avi dev` reads the constructor's types and keeps the list in
`src/inject.gen.ts`, a generated file like `api.gen.ts`. Avi.js wires classes from such lists,
never from `reflect-metadata`. You can also write the list yourself, `static inject =
[PostsService] as const`, and then it wins ([chapter 3](03-modules-and-di.md#dependency-lists)).

## Add Avi.js to an existing project

```sh
npm install @avijs/core
```

```ts
import { createAvi, defineController } from '@avijs/core';

const app = createAvi().register({
  controllers: [
    defineController({
      routes: [{ method: 'GET', path: '/', handler: () => ({ hello: 'world' }) }],
    }),
  ],
});
await app.listen(3000);
```

Avi.js is ESM. Use `"type": "module"` in `package.json` and `"module": "NodeNext"` in
`tsconfig.json`, and leave `experimentalDecorators` off: Avi.js uses standard decorators.

## Next

[Chapter 1: Your first app](01-first-app.md) walks through a small app line by line. To work on
Avi.js itself, see [CONTRIBUTING.md](https://github.com/chrischase011/avi-js/blob/main/CONTRIBUTING.md).
