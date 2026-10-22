# 3. Modules and dependency injection

> **Status: Planned (Phase 3).** This chapter shows the target API. The code does not run yet.

## Services declare their dependencies

Avi.js does not use `reflect-metadata` and does not guess constructor types. A class lists what it
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
so typos fail at compile time instead of at runtime.

## Modules group providers

```ts
import { defineModule } from '@avi/core';

export const GreetingModule = defineModule({
  providers: [GreetingService, { provide: GreeterConfig, useValue: { greeting: 'Hello' } }],
  exports: [GreetingService],
});
```

A module only sees its own providers plus what its imports export. `GreeterConfig` is not exported,
so other modules cannot inject it.

## Using a service from a controller

```ts
const greetings = defineController({
  prefix: '/greet',
  inject: [GreetingService],
  routes: (greeter) => [
    {
      method: 'GET',
      path: '/:name',
      handler: (ctx) => ({ message: greeter.greet(ctx.params.name) }),
    },
  ],
});

const app = createAvi();
app.register({ imports: [GreetingModule], controllers: [greetings] });
```

`greeter` is typed as `GreetingService`, inferred from `inject`. No annotation needed.

## Provider forms

```ts
providers: [
  GreetingService, // class shorthand
  { provide: GreeterConfig, useValue: { greeting: 'Hi' } }, // value
  { provide: Clock, useFactory: () => new SystemClock() }, // factory
  { provide: Db, useFactory: (cfg) => connect(cfg.url), inject: [DbConfig] },
  { provide: RequestId, useClass: RandomId, scope: 'transient' },
];
```

| Scope                 | Behavior                                    |
| --------------------- | ------------------------------------------- |
| `singleton` (default) | Created once at startup, shared by everyone |
| `transient`           | A new instance every time it is injected    |

## Mistakes are caught at startup

Avi.js validates the whole graph before it listens. Each of these stops startup with a message
naming the module and the token:

- injecting a provider that is not registered or not exported to you
- exporting something the module does not provide
- registering the same token twice in one module
- a dependency cycle (`A → B → A`)

## Next

[Chapter 4: Controllers](04-controllers.md).
