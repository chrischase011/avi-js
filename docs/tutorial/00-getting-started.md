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
Listening on http://localhost:3000
```

Open http://localhost:3000/users. `npm run dev` recompiles and restarts on every change.

Without a name, `npm create avi@latest` asks for the name and the template. There are two:

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
│   ├── common/
│   │   └── health.controller.ts   GET /health
│   └── modules/users/
│       ├── users.module.ts
│       ├── users.controller.ts    GET /users, GET /users/:id, POST /users
│       ├── users.service.ts
│       ├── users.test.ts
│       └── dto/
├── package.json
└── tsconfig.json
```

| Script          | What it does                                        |
| --------------- | --------------------------------------------------- |
| `npm run dev`   | Compile, then recompile and restart on every change |
| `npm test`      | Compile and run the tests with `node --test`        |
| `npm run build` | Compile to `dist/`                                  |
| `npm start`     | Run the compiled app                                |
| `npm run check` | Check every `static inject` list against its class  |

## Add a feature

The CLI creates files and registers them for you:

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
```

`npm run dev` picks the change up, and http://localhost:3000/posts answers `[]`. The controller
injects the service it found next to it:

```ts
@Controller('/posts')
export class PostsController {
  static inject = [PostsService] as const;

  constructor(private readonly posts: PostsService) {}

  @Get()
  findAll() {
    return this.posts.findAll();
  }
}
```

`static inject` lists the constructor's dependencies in order. That list is how Avi.js wires
classes together without `reflect-metadata`, and TypeScript checks it against the constructor.

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

Avi.js is ESM. Use `"type": "module"` and `"module": "NodeNext"` in `tsconfig.json`, and leave
`experimentalDecorators` off: Avi.js uses standard decorators.

## Next

[Chapter 1: Your first app](01-first-app.md) walks through a small app line by line. To work on
Avi.js itself, see [CONTRIBUTING.md](https://github.com/chrischase011/avi-js/blob/main/CONTRIBUTING.md).
