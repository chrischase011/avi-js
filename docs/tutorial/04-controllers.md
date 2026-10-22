# 4. Controllers: explicit and decorator styles

> **Status: Planned (Phase 4).** This chapter shows the target API. The code does not run yet.

Avi.js has two ways to write controllers. They run on the same engine and behave the same, so
pick the one your team prefers. You can mix them in one app.

## Explicit style

No decorators and no classes required:

```ts
export const users = defineController({
  prefix: '/users',
  inject: [UsersService],
  routes: (users) => [
    { method: 'GET', path: '/', handler: () => users.findAll() },
    { method: 'GET', path: '/:id', handler: (ctx) => users.findOne(ctx.params.id) },
  ],
});
```

## Decorator style

```ts
import { Controller, Get, Injectable, Module, AviFactory, type Context } from '@avi/core';

@Injectable()
class UsersService {
  findAll() {
    return [{ id: '1', name: 'Ada' }];
  }

  findOne(id: string) {
    return this.findAll().find((user) => user.id === id);
  }
}

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

## Coming from NestJS

| NestJS                                       | Avi.js                                     |
| -------------------------------------------- | ------------------------------------------ |
| `reflect-metadata` + `emitDecoratorMetadata` | Not needed                                 |
| `experimentalDecorators: true`               | Leave it off: Avi uses standard decorators |
| Constructor types discovered by reflection   | `static inject = [...] as const`           |
| `@Param('id') id: string`                    | `ctx.params.id`                            |
| `@Query()`, `@Body()`                        | `ctx.query`, `ctx.body`                    |

Standard decorators have no parameter decorators, so handlers read everything from `ctx`.

## TypeScript setup for decorators

Nothing extra. Standard decorators work with a normal `tsconfig.json`. Just make sure
`experimentalDecorators` is **not** enabled.

## Next

[Chapter 5: Middleware, guards and errors](05-request-pipeline.md).
