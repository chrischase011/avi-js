# 13. Configuration

> **Status: Runnable.** Everything on this page works today.

Apps read their settings from environment variables: ports, database URLs, API keys. `defineConfig`
checks them with the same schemas you use for routes, gives you a typed object, and stops the app
at startup when something is missing or wrong.

## Defining the config

```ts
// src/config.ts
import { defineConfig, type TokenType } from '@avijs/core';
import * as v from 'valibot';

const env = v.object({
  PORT: v.optional(v.pipe(v.string(), v.regex(/^\d+$/), v.transform(Number)), '3000'),
  DATABASE_URL: v.pipe(v.string(), v.url()),
  LOG_LEVEL: v.optional(v.picklist(['info', 'warn', 'error']), 'info'),
});

export const Config = defineConfig(env, { envFile: '.env' });
export type Config = TokenType<typeof Config>; // the validated values
```

Any Standard Schema library works; with Zod the same is `z.object({ PORT: z.coerce.number() ... })`.
The type of the config is the schema's output: here `{ PORT: number; DATABASE_URL: string; LOG_LEVEL:
'info' | 'warn' | 'error' }`.

Projects created with `npm create avi` and a validator already have a `src/config.ts` with `PORT`.
The `Config` type next to the token names the values, so `config: Config` reads like any other
dependency.

## Using it

`Config` is an injection token. Import `Config.module` where it is needed and inject it like any
other dependency:

```ts
@Injectable()
export class Database {
  // Config is a token named like its type, so avi dev infers it; no list needed.
  constructor(private readonly config: Config) {}

  connect() {
    return createPool(this.config.DATABASE_URL);
  }
}

@Module({ imports: [Config.module], providers: [Database], exports: [Database] })
export class DatabaseModule {}
```

A database client is usually built by a factory instead. `defineFactory` types its parameters from
`inject` ([chapter 3](03-modules-and-di.md#provider-forms)):

```ts
export const Db = createToken<PrismaClient>('Db');

@Module({
  imports: [Config.module],
  providers: [
    defineFactory({
      provide: Db,
      inject: [Config],
      useFactory: async (config) => {
        const db = new PrismaClient({ adapter: new PrismaLibSql({ url: config.DATABASE_URL }) });
        await db.$connect();
        return db;
      },
      dispose: (db) => db.$disconnect(),
    }),
  ],
  exports: [Db],
})
export class DatabaseModule {}
```

Every module that imports `Config.module` shares one validated instance. In `main.ts`, read it from
the app:

```ts
const app = await AviFactory.create(AppModule);
await app.listen(app.get(Config).PORT);
```

Outside the app, in a script or a test, `await Config.load()` reads and validates the config
directly. To register the provider yourself instead of importing the module, use `Config.provider`.

## When something is wrong

The app does not start. The error lists every problem, by variable name:

```text
ConfigError: Invalid configuration: DATABASE_URL: Invalid URL: Received "[redacted]"; LOG_LEVEL: Invalid type
```

Values are never included, even when the schema library quotes them in its message or a transform
changed them first: a quoted value is replaced by `"[redacted]"`, while the options a schema
expects (`"info" | "warn"`) stay. A schema that throws (a
`JSON.parse` transform on bad input, say) reports `the schema threw while reading the variables`,
without the original error, whose message may quote the value. So a mistyped secret cannot end up
in your logs. `ConfigError` also has the problems as data, in `error.issues`.

## Where values come from

1. Environment variables that are set, such as those from your platform or `PORT=8080 npm start`.
2. The `envFile`, if you pass one and it exists. Variables that are already set win over it.

The file is read with Node's own `.env` parser; Avi.js does not need `dotenv`, and it never changes
`process.env`. A missing file is skipped. Make it required with
`{ envFile: { path: '.env', required: true } }`.

Keep `.env` out of git (new projects already ignore it) and use your platform's secrets in
production.

## Testing

Pass `env` to validate a fixed set of values instead of `process.env`:

```ts
const TestConfig = defineConfig(env, { env: { DATABASE_URL: 'postgres://localhost/test' } });
```

Or replace the whole config in a test with `overrides`:

```ts
const client = await createTestClient(AppModule, {
  overrides: [{ provide: Config, useValue: { PORT: 0, DATABASE_URL: 'x', LOG_LEVEL: 'info' } }],
});
```

## Next

[Chapter 14: File uploads](14-file-uploads.md).
