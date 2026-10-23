# 9. Project structure

> **Status: Runnable.** Everything on this page works today. `avi new` generates both layouts;
> `examples/modular-api` follows the modular one.

Avi.js has two official templates. They differ only in how you organize code: both use the same
router, DI container and request pipeline, so an app behaves the same either way.

```sh
npm create avi@latest my-api                          # modular (default)
npm create avi@latest my-api -- --template minimal
```

Each generated project compiles, has a passing test suite and serves `/health` and `/users` out of
the box:

| Script          | Does                                                        |
| --------------- | ----------------------------------------------------------- |
| `npm run dev`   | `avi dev`: compiles, then recompiles and restarts on change |
| `npm test`      | compiles and runs the tests with Node's test runner         |
| `npm run check` | `avi check`: type-checks every `static inject` list         |
| `npm start`     | runs the compiled app                                       |

The `users` routes validate input with route schemas, using [Valibot](https://valibot.dev) by
default. Pick another library, or none, with `--validator`:

| Option              | Generated validation                          |
| ------------------- | --------------------------------------------- |
| `valibot` (default) | Valibot schemas for params, body and response |
| `zod`               | The same with [Zod](https://zod.dev)          |
| `none`              | Handwritten checks and no extra dependency    |

Invalid input gets the standard `400` with every issue listed ([chapter 6](06-validation.md)).
Response schemas drop fields they don't list, so internal data cannot leak by accident.

The layouts are conventions. Avi.js never scans folders or depends on file names. You register
what you use, wherever it lives.

## Minimal template

Functional and explicit. Good for small services, prototypes and people new to Avi.js.

```text
src/
├── main.ts
├── routes/
│   └── users.ts
└── services/
    └── users.ts
```

```ts
// src/services/users.ts
export class UsersService {
  #users = [{ id: '1', name: 'Shiela' }];

  findAll() {
    return this.#users;
  }
}
```

```ts
// src/routes/users.ts
import { defineController } from '@avijs/core';
import { UsersService } from '../services/users.js';

export const usersRoutes = defineController({
  prefix: '/users',
  inject: [UsersService],
  routes: (users) => [{ method: 'GET', path: '/', handler: () => users.findAll() }],
});
```

```ts
// src/main.ts
import { createAvi } from '@avijs/core';
import { usersRoutes } from './routes/users.js';
import { UsersService } from './services/users.js';

const app = createAvi();
app.register({ providers: [UsersService], controllers: [usersRoutes] });
await app.listen(3000);
```

## Modular template

Feature-first. Each feature folder owns its module, controller, service and DTOs. Good for larger
APIs and teams.

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

```ts
// src/modules/users/users.service.ts
import { Injectable } from '@avijs/core';

@Injectable()
export class UsersService {
  #users = [{ id: '1', name: 'Shiela' }];

  findAll() {
    return this.#users;
  }
}
```

```ts
// src/modules/users/users.controller.ts
import { Controller, Get } from '@avijs/core';
import { UsersService } from './users.service.js';

@Controller('/users')
export class UsersController {
  static inject = [UsersService] as const;

  constructor(private readonly users: UsersService) {}

  @Get('/')
  findAll() {
    return this.users.findAll();
  }
}
```

```ts
// src/modules/users/users.module.ts
import { Module } from '@avijs/core';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({ controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
```

```ts
// src/app.module.ts
import { Module } from '@avijs/core';
import { UsersModule } from './modules/users/users.module.js';

@Module({ imports: [UsersModule] })
export class AppModule {}
```

```ts
// src/main.ts
import { AviFactory } from '@avijs/core';
import { AppModule } from './app.module.js';

const app = await AviFactory.create(AppModule);
await app.listen(3000);
```

`common/` holds code shared across features, such as guards, middleware and helpers.

## Generating code

`avi generate` (short: `avi g`) adds a module, controller or service and registers it for you:

```sh
npx avi g module posts             # src/modules/posts/posts.module.ts, imported by AppModule
npx avi g service posts            # posts.service.ts, added to PostsModule providers
npx avi g controller posts         # posts.controller.ts, added to PostsModule controllers
npx avi g controller admin/reports # src/modules/admin/reports/reports.controller.ts
```

For a whole feature at once, generate a resource. It creates the module, service and controller
with working CRUD routes (`GET`, `POST`, `PATCH`, `DELETE`) backed by an in-memory store:

```sh
npx avi g resource posts           # or: npx avi g res posts
```

Replace the store in the service with your database; the routes stay the same.

A resource validates with the library in your `package.json` (Valibot first, then Zod), or the one
you pass with `--validator`. It writes the schemas to `posts.schemas.ts`, starting with a single
`title` field: add your fields there. Request bodies lose any field the schema does not list, so a
client cannot store `"role": "admin"` by sending it. Updates need at least one field.

Without a validation library, the resource uses handwritten checks and stores bodies as sent, and
the CLI prints a note saying so. Install Valibot or Zod before using it for real data.

In a minimal project, a resource is a schema file in `src/schemas/`, a service in
`src/services/` and routes in `src/routes/`.

The short kinds `mo`, `co`, `s` and `res` work too. A path like `admin/reports` creates folders; the
last part is the name. A controller generated next to an existing service injects it.

Each new file is registered in the nearest module, walking up from its folder to
`src/app.module.ts`. In a minimal project (`src/app.ts`), controllers go to `src/routes/`,
services to `src/services/`, and both are added to the `register()` call in `src/app.ts`.

The CLI edits your files through the TypeScript parser and only adds an import and an array entry.
When it cannot find where to register something, it changes nothing and prints what to add. It
never overwrites an existing file, and `--dry-run` lists the changes without writing them.

## Growing from minimal to modular

You do not have to rewrite the app. Move one feature at a time:

1. Create `src/modules/users/` and move the users service and routes into it.
2. Group them in a module (`defineModule` or `@Module`) that exports what other features need.
3. Import that module where the routes used to be registered.

Explicit and decorator code can live side by side during the move, because both normalize to the
same definitions.

## Next

[Chapter 10: Build-time checks and manifests](10-build-checks.md).
