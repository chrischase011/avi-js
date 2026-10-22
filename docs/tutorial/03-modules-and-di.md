# 3. Modules and dependency injection

> **Status: Runnable.** Everything on this page works today. The decorator versions
> (`@Injectable`, `@Module`) arrive in [Chapter 4](04-controllers.md).

## Services declare their dependencies

Avi.js does not use `reflect-metadata` and never guesses constructor types. A class lists what it
needs in `static inject`, in constructor order:

```ts
import { createToken } from '@avi/core';

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
so a typo fails to compile instead of failing at runtime. If a constructor takes more arguments
than `inject` lists, startup fails and names the class.

## Modules group providers

```ts
import { defineModule } from '@avi/core';

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
import { createAvi, defineController } from '@avi/core';

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
curl localhost:3000/greet/Ada   # {"message":"Hello, Ada!"}
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

Annotate factory parameters yourself: inside a `providers` array TypeScript cannot infer them from
`inject`.

| Scope                 | Behavior                                                                 |
| --------------------- | ------------------------------------------------------------------------ |
| `singleton` (default) | Created once at startup and shared                                       |
| `transient`           | A new instance on every injection. Inside a singleton, created just once |

## Async setup

Singleton factories can be `async`. Avi.js awaits them before the server starts:

```ts
{
  provide: Db,
  useFactory: async (config: DbConfig) => {
    const db = new DbClient(config.url);
    await db.connect();
    return db;
  },
  inject: [DbConfig],
}
```

Transient factories must stay synchronous; an async one fails at startup.

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
{ provide: Cache, useFactory: () => createCache(), dispose: (cache: Cache) => cache.quit() }
```

Avi.js only disposes what it created: `useValue` values and transients are left alone.

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
