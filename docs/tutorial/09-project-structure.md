# 9. Project structure

> **Status: Planned (Phase 9).** The `avi` CLI and the decorator API do not exist yet. This
> chapter shows the target layouts.

Avi.js has two official templates. They differ only in how you organize code: both use the same
router, DI container and request pipeline, so an app behaves the same either way.

```sh
avi new my-api                      # modular (default)
avi new my-api --template minimal
```

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
  #users = [{ id: '1', name: 'Ada' }];

  findAll() {
    return this.#users;
  }
}
```

```ts
// src/routes/users.ts
import { defineController } from '@avi/core';
import { UsersService } from '../services/users.js';

export const usersRoutes = defineController({
  prefix: '/users',
  inject: [UsersService],
  routes: (users) => [{ method: 'GET', path: '/', handler: () => users.findAll() }],
});
```

```ts
// src/main.ts
import { createAvi } from '@avi/core';
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
import { Injectable } from '@avi/core';

@Injectable()
export class UsersService {
  #users = [{ id: '1', name: 'Ada' }];

  findAll() {
    return this.#users;
  }
}
```

```ts
// src/modules/users/users.controller.ts
import { Controller, Get } from '@avi/core';
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
import { Module } from '@avi/core';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({ controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
```

```ts
// src/app.module.ts
import { Module } from '@avi/core';
import { UsersModule } from './modules/users/users.module.js';

@Module({ imports: [UsersModule] })
export class AppModule {}
```

```ts
// src/main.ts
import { AviFactory } from '@avi/core';
import { AppModule } from './app.module.js';

const app = await AviFactory.create(AppModule);
await app.listen(3000);
```

`common/` holds code shared across features, such as guards, middleware and helpers.

## Growing from minimal to modular

You do not have to rewrite the app. Move one feature at a time:

1. Create `src/modules/users/` and move the users service and routes into it.
2. Group them in a module (`defineModule` or `@Module`) that exports what other features need.
3. Import that module where the routes used to be registered.

Explicit and decorator code can live side by side during the move, because both normalize to the
same definitions.

## Next

Back to the [tutorial index](README.md).
