# 11. OpenAPI documents

> **Status: Runnable.** Everything on this page works today. `OpenApiModule` needs 0.7.0 or newer.

`@avijs/openapi` builds an OpenAPI 3.1 document from your app: every route, including routes
created at runtime, with parameters, request bodies and responses taken from route schemas.

## Serve it

Import `OpenApiModule` and the app serves its document at `/openapi.json`:

```ts
import { OpenApiModule } from '@avijs/openapi';

@Module({
  imports: [
    OpenApiModule.forRoot({
      info: { title: 'Greeter API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      path: '/openapi.json', // the default
    }),
    UsersModule,
  ],
})
export class AppModule {}
```

The document is built from the running app on the first request and then kept. Its own route is
left out of it. To serve docs only outside production, import the module conditionally.

## Generate it

For a file, a build step or a test, `generateOpenApi` takes an initialized app:

```ts
import { createAvi } from '@avijs/core';
import { generateOpenApi } from '@avijs/openapi';

const app = createAvi().register(AppModule);
await app.init();

const document = generateOpenApi(app, { info: { title: 'Greeter API', version: '1.0.0' } });
```

`OpenApiModule.forRoot` takes the same options, plus `path`.

## What ends up in the document

| From the route     | In the document                                               |
| ------------------ | ------------------------------------------------------------- |
| `/users/:id`       | path `/users/{id}` with a required `id` parameter             |
| a trailing `*`     | a `{wildcard}` path parameter                                 |
| `schema.params`    | the parameter schemas                                         |
| `schema.query`     | one query parameter per property, `required` as in the schema |
| `schema.body`      | a required JSON request body                                  |
| `schema.response`  | the `200` response body                                       |
| any input schema   | a `400` response with the validation error shape              |
| `openapi: { ... }` | `summary`, `description`, `tags`, `operationId`, `deprecated` |

Add the documentation fields to a route, or to a route decorator:

```ts
route({
  method: 'GET',
  path: '/:id',
  schema: { params: UserId, response: PublicUser },
  openapi: { summary: 'Get a user', tags: ['users'] },
  handler: (ctx) => users.find(ctx.input.params.id),
});

@Get('/:id', { schema: { params: UserId }, openapi: { summary: 'Get a user' } })
```

## Turning schemas into JSON Schema

Validation schemas and JSON Schema are different things, so the generator needs a converter:

- Schemas that implement the Standard JSON Schema extension (`~standard.jsonSchema`) are converted
  automatically. **Zod 4** does, so Zod schemas need no setup.
- Otherwise pass `toJsonSchema`. For **Valibot**, use `@valibot/to-json-schema`:

```ts
import { toJsonSchema } from '@valibot/to-json-schema';

generateOpenApi(app, {
  info: { title: 'Greeter API', version: '1.0.0' },
  // errorMode: 'ignore' skips actions JSON Schema cannot express, such as v.transform, and keeps
  // the rest, so a generated id param is documented as a string of digits.
  toJsonSchema: (schema) => toJsonSchema(schema as never, { errorMode: 'ignore' }),
});
```

Path, query and body schemas are documented as their **input** (what the client sends, before
transforms), response schemas as their **output**. If a converter fails, the error names the route
and the schema: `Cannot convert the params schema of GET /users/:id to JSON Schema: ...`.

Without a converter, the route is still documented, with an empty schema where the body would be.

## Next

[Chapter 12: Security headers, CORS and rate limits](12-security.md).
