# 4. Controllers: explicit and decorator styles

> **Status: Runnable.** Everything on this page works today. The decorator version lives in
> `examples/modular-api`.

Avi.js has two ways to write controllers, services and modules. Both produce the same internal
definitions and run on the same engine, so an app behaves identically either way. You can mix
them in one app, even in one module.

## Explicit style

No decorators and no classes required:

```ts
import { createAvi, defineController, defineModule } from '@avijs/core';

const users = defineController({
  prefix: '/users',
  inject: [UsersService],
  routes: (users) => [
    { method: 'GET', path: '/', handler: () => users.findAll() },
    { method: 'GET', path: '/:id', handler: (ctx) => users.findOne(Number(ctx.params['id'])) },
  ],
});

const AppModule = defineModule({ providers: [UsersService], controllers: [users] });
await createAvi().register(AppModule).listen(3000);
```

## Decorator style

```ts
import { AviFactory, Controller, Get, Injectable, Module, type Context } from '@avijs/core';

@Injectable()
class UsersService {
  findAll() {
    return [{ id: 1, name: 'Shiela' }];
  }

  findOne(id: number) {
    return this.findAll().find((user) => user.id === id);
  }
}

@Controller('/users')
class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get('/:id')
  findOne(ctx: Context) {
    return this.users.findOne(Number(ctx.params['id']));
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
class AppModule {}

const app = await AviFactory.create(AppModule);
await app.listen(3000);
```

## The decorators

| Decorator                                                                | On     | Does                                                                    |
| ------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------- |
| `@Controller(prefix?)`                                                   | class  | Makes the class a controller. One per app, or per request (see ch. 3).  |
| `@Get(path?)`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head`, `@Options` | method | Registers the method as a handler. It receives `ctx`, `this` is bound.  |
| `@Injectable({ scope? })`                                                | class  | Optional. Sets the scope and checks `static inject` at compile time.    |
| `@Module({ ... })`                                                       | class  | Same options as `defineModule`. The class name becomes the module name. |

`AviFactory.create(AppModule, options?)` is `createAvi(options).register(AppModule)` plus
`await app.init()`: it returns an app whose providers already exist, ready to `listen()`.

Decorators always need parentheses: `@Get()`, not `@Get`. Avi.js tells you if you forget.

## Dependencies stay explicit

The controller above names no dependency list: `avi dev` infers it from the constructor and keeps
it in `src/inject.gen.ts` ([chapter 3](03-modules-and-di.md#dependency-lists)). The list still
exists as code, never as runtime reflection. A class can also list its dependencies itself in
`static inject`, in constructor order, declared `as const`; with `@Injectable` or `@Controller`,
TypeScript checks that list against the constructor:

```ts
@Injectable()
class Repo {
  static inject = [Config, Db] as const; // ✗ swapped
  constructor(
    readonly db: Db,
    readonly config: Config,
  ) {}
}
```

```text
error TS1238: Unable to resolve signature of class decorator when called as an expression.
  Property ''static inject must list the constructor parameter types in order, declared `as const`''
  is missing in type 'typeof Repo'
```

Undecorated classes still get the runtime check: a constructor that takes more arguments than its
list, written or generated, stops startup.

## Scopes

```ts
@Injectable({ scope: 'transient' })
class RequestId {
  readonly value = crypto.randomUUID();
}

@Module({ providers: [RequestId] }) // transient, from @Injectable
class AppModule {}
```

## Inheritance

Route decorators on a base class are inherited. Handlers dispatch to overrides:

```ts
class HealthBase {
  @Get('/health')
  health() {
    return 'ok';
  }
}

@Controller('/billing')
class BillingController extends HealthBase {} // serves GET /billing/health
```

## Mixing styles

`controllers` accepts `@Controller` classes and `defineController` results. `imports` and
`register()` accept `@Module` classes and `defineModule` modules. A decorated module can import an
explicit one and the other way round.

## If you know NestJS

Avi.js is inspired by NestJS, so the decorators will look familiar. A few work differently:

| In NestJS                                    | In Avi.js                                        |
| -------------------------------------------- | ------------------------------------------------ |
| `reflect-metadata` + `emitDecoratorMetadata` | Lists generated by `avi dev`, or `static inject` |
| `experimentalDecorators: true`               | Standard decorators; leave it off                |
| `@Param('id') id: string`                    | `ctx.params['id']`                               |
| `@Query()`, `@Body()`                        | `ctx.query`, `await ctx.json()`                  |
| `@Global()` modules                          | Imports are always explicit                      |
| `forwardRef()`                               | Cycles are reported at startup instead           |

Standard decorators have no parameter decorators, so handlers read everything from `ctx`.
[Avi.js for NestJS developers](99-from-nestjs.md) has the full concept map.

## Tooling setup

**TypeScript.** Nothing extra. Make sure `experimentalDecorators` is **off**; Avi.js detects the
legacy mode and tells you to turn it off.

**ESLint.** `typescript-eslint`'s strict preset flags empty classes such as
`@Module({...}) class AppModule {}`. Allow decorated ones:

```js
rules: {
  '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
}
```

**Vitest.** Vite's built-in TypeScript transform does not compile standard decorators yet. Compile
test files with `tsc` instead, with a small plugin in `vitest.config.ts`:

```ts
import ts from 'typescript';
import { defineConfig, type Plugin } from 'vitest/config';

const typescript: Plugin = {
  name: 'typescript-decorators',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('.ts') || id.includes('/node_modules/')) return null;
    const out = ts.transpileModule(code, {
      fileName: id,
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
        sourceMap: true,
      },
    });
    return { code: out.outputText, map: out.sourceMapText ?? null };
  },
};

export default defineConfig({ plugins: [typescript] });
```

The Avi.js repository uses exactly this setup.

## Next

[Chapter 5: Middleware, guards and errors](05-request-pipeline.md).
