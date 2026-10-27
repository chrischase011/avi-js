# 3. Modules and dependency injection

> **Status: Runnable.** Everything on this page works today. The decorator versions
> (`@Injectable`, `@Module`) arrive in [Chapter 4](04-controllers.md).

## Dependency lists

Avi.js does not use `reflect-metadata`: TypeScript's types are gone at runtime, so each class has a
list of what to inject, in constructor order. You write it, or the build writes it for you.

**Written for you.** In a project from `npm create avi`, a class just takes its dependencies:

```ts
export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}
}
```

`avi dev` and `avi build` read the constructor's types with the TypeScript compiler they already
run, and keep the lists in `src/inject.gen.ts` (from 1.0.0-rc.3), which `app.module.ts` imports
first:

```ts
// src/inject.gen.ts, generated: do not edit
registerInjects([[UsersService, [Db, Config]]]);
```

It is plain code you can read and commit, so tests and other runners need no plugin, and it only
changes when a constructor does. A type can be inferred when it is a class, or has a token of the
same name: `PrismaClient`, `Config` with `type Config = TokenType<typeof Config>`, or
`createToken<Db>('Db')` next to `interface Db`. For anything else, such as a `string`, the build
warns (`AVI201`) and names the class. Outside `avi dev`, `avi inject` writes the file once.

The lists are loaded by the import in `app.module.ts`. An entry point that does not import the app
module, such as a worker built from a few modules, imports `./inject.gen.js` itself; a test that
registers single providers does the same.

**Written by you.** A class can always list its dependencies in `static inject`. A list in the
class wins over a generated one, and it needs no build step:

```ts
import { createToken } from '@avijs/core';

export interface GreeterConfig {
  greeting: string;
}

export const GreeterConfig = createToken<GreeterConfig>('GreeterConfig');

export class GreetingService {
  static inject = [GreeterConfig] as const;

  constructor(private readonly config: GreeterConfig) {}

  greet(name: string) {
    return `${this.config.greeting}, ${name}!`;
  }
}
```

A token is either a class or a typed token from `createToken<T>()`. Plain strings are not tokens,
so a typo fails to compile instead of failing at runtime. With `@Injectable` or `@Controller`,
TypeScript checks a written list against the constructor. If a class has no list at all, startup
fails, names the class, and says how to fix it.

## Modules group providers

```ts
import { defineModule } from '@avijs/core';

export const GreetingModule = defineModule({
  name: 'GreetingModule',
  providers: [GreetingService, { provide: GreeterConfig, useValue: { greeting: 'Hello' } }],
  exports: [GreetingService],
});
```

A module sees its own providers plus what its **direct** imports export. `GreeterConfig` is not
exported, so other modules cannot inject it. Give modules a `name`: it appears in every error
message.

## Using a service from a controller

```ts
import { createAvi, defineController } from '@avijs/core';

const greetings = defineController({
  prefix: '/greet',
  inject: [GreetingService],
  routes: (greeter) => [
    {
      method: 'GET',
      path: '/:name',
      handler: (ctx) => ({ message: greeter.greet(ctx.params['name'] ?? 'you') }),
    },
  ],
});

const app = createAvi();
app.register({ imports: [GreetingModule], controllers: [greetings] });
await app.listen(3000);
```

```sh
curl localhost:3000/greet/Shiela   # {"message":"Hello, Shiela!"}
```

`greeter` is typed as `GreetingService`, inferred from `inject`. No annotation needed.

Modules can hold controllers too. A module's `prefix` applies to its own controllers:

```ts
const UsersModule = defineModule({
  name: 'UsersModule',
  prefix: '/api',
  imports: [GreetingModule],
  controllers: [greetings], // served at /api/greet/:name
});

app.register({ imports: [UsersModule] });
```

## Provider forms

```ts
providers: [
  GreetingService, // class shorthand
  { provide: GreeterConfig, useValue: { greeting: 'Hi' } }, // a value
  { provide: Clock, useClass: SystemClock }, // a class for another token
  { provide: Db, useFactory: (config: DbConfig) => connect(config.url), inject: [DbConfig] },
  { provide: RequestId, useClass: RandomId, scope: 'transient' },
];
```

Inside a `providers` array TypeScript cannot infer a factory's parameters from `inject`, so a
factory written as above is not checked against it. Wrap it in `defineFactory` and it is: the
parameters are typed from `inject` in order, and the result must fit `provide`.

```ts
import { defineFactory } from '@avijs/core';

defineFactory({
  provide: Db,
  inject: [DbConfig, Logger],
  useFactory: (config, logger) => connect(config.url, logger), // config: DbConfig, logger: Logger
});
```

Tokens in the wrong order, or a factory returning something other than a `Db`, fail to compile.

| Scope                 | Behavior                                                                 |
| --------------------- | ------------------------------------------------------------------------ |
| `singleton` (default) | Created once at startup and shared                                       |
| `transient`           | A new instance on every injection. Inside a singleton, created just once |
| `request`             | One instance per request, disposed after the handler                     |

## Request scope

A request-scoped provider gets a fresh instance for each request, shared by everything that
injects it during that request. Inject `REQUEST` to read the request itself:

```ts
import { Injectable, REQUEST, type Context } from '@avijs/core';

@Injectable({ scope: 'request' })
class CurrentUser {
  // REQUEST is not named like its type Context, so this class lists what it needs.
  static inject = [REQUEST, UsersService] as const;
  readonly id: string;
  constructor(ctx: Context, users: UsersService) {
    this.id = users.idFromToken(ctx.headers.authorization);
  }
}

// or as a factory, which may return a plain value
defineFactory({
  provide: TenantId,
  inject: [REQUEST],
  scope: 'request',
  useFactory: (ctx) => ctx.headers['x-tenant'],
});
```

Likewise, `APP` injects the app itself, for providers that read its routes; `OpenApiModule` uses
it.

A controller that injects a request-scoped provider, directly or through a transient, is created
for each request. Other controllers are still created once. Use request scope where you need it, not
by default: each request then builds the controller and its request providers.

The rules are checked at startup:

- A singleton cannot depend on a request-scoped provider, since it would keep the first request's
  instance forever. Make it request-scoped or transient.
- Middleware and guard classes are created once, so they cannot use request scope. Read the
  request from `ctx`, and pass data along with `ctx.state`.
- A controller may only use a request-scoped dependency inside its route handlers, not in its
  constructor.

Request-scoped instances are disposed with `Symbol.dispose`, `Symbol.asyncDispose` or a factory's
`dispose` after the handler returns or throws. A disposal error is logged and does not change the
response. A streamed response may still be sending when that happens, so don't hand a
request-scoped resource to a stream.

## Async setup

Singleton factories can be `async`. Avi.js awaits them before the server starts:

```ts
defineFactory({
  provide: Db,
  inject: [DbConfig],
  useFactory: async (config) => {
    const db = new DbClient(config.url);
    await db.connect();
    return db;
  },
});
```

Transient and request-scoped factories must stay synchronous; an async one fails when it is first
used.

## Cleanup on shutdown

`app.close()` stops the server, waits for in-flight requests, then disposes providers in reverse
creation order, so a repository closes before the database it uses:

```ts
class Db {
  async [Symbol.asyncDispose]() {
    await this.pool.end();
  }
}

// or, for a factory
defineFactory({
  provide: Cache,
  useFactory: () => createCache(),
  dispose: (cache) => cache.quit(),
});
```

Avi.js only disposes what it created: `useValue` values and transients are left alone.
Request-scoped instances are disposed at the end of each request instead.

## Configurable modules

A module that needs settings is a function that returns a new definition:

```ts
export const ConfigModule = {
  forRoot: (greeting: string) =>
    defineModule({
      name: 'ConfigModule',
      providers: [{ provide: GreeterConfig, useValue: { greeting } }],
      exports: [GreeterConfig],
    }),
};

app.register({ imports: [ConfigModule.forRoot('Hi')], providers: [GreetingService] });
```

A module can also re-export: list a token it imported, or the imported module itself, in its
`exports`.

## Mistakes are caught at startup

`app.init()` builds and checks the whole graph; `listen()` calls it for you. Each of these stops
startup with a message naming the module and token:

- injecting something that is not provided or not exported to you
- exporting something the module neither provides nor imports
- providing the same token twice in one module
- a dependency cycle (`A → B → A`) or a module import cycle
- the same token exported by two different imports

```text
Cannot resolve AppModule controller /greet → GreetingService in AppModule:
GreetingService is not provided by AppModule or exported by its imports (HiddenModule)
```

If a token shows up as `undefined` (`is there a circular import?`), two of your files import each
other.

## Every app is separate

Two `createAvi()` apps built from the same modules never share instances. Each `register()` call
adds a separate root module; root modules only see each other's providers through imports.

## Getting a provider in tests and scripts

```ts
const app = createAvi().register({ imports: [GreetingModule] });
await app.init();
app.get(GreetingService).greet('Grace'); // typed as GreetingService
await app.close();
```

`app.get()` only sees what the root modules can see. Use it in tests and scripts, not to fetch
services inside your application code.

## Next

[Chapter 4: Controllers](04-controllers.md).
