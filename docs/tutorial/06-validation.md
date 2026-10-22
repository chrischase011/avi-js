# 6. Validation and typed input

> **Status: Runnable.** Everything on this page works today.

Avi.js validates route input with any library that implements
[Standard Schema](https://standardschema.dev): Zod (3.24+), Valibot, ArkType, Effect Schema and
others. There are no adapters to install and no validation library is bundled. The examples below
use Valibot; swap in your own.

## Validating a route

Give the route a `schema` with any of `params`, `query` and `body`. Wrap it in `route()` so
TypeScript infers the types:

```ts
import { defineController, route } from '@avijs/core';
import * as v from 'valibot';

const CreateUser = v.object({
  name: v.pipe(v.string(), v.minLength(1, 'name is required')),
  email: v.pipe(v.string(), v.email()),
});

const users = defineController({
  prefix: '/users',
  routes: [
    route({
      method: 'POST',
      path: '/',
      schema: { body: CreateUser },
      handler: (ctx) => {
        const { name, email } = ctx.input.body; // { name: string; email: string }
        return reply(service.create(name, email), { status: 201 });
      },
    }),
  ],
});
```

Validated data lands on `ctx.input.params`, `ctx.input.query` and `ctx.input.body`, typed from
each schema's output. The raw request is untouched: `ctx.params`, `ctx.query` and `ctx.json()`
still work.

With a `body` schema, Avi.js reads the JSON for you, with the usual rules: `413` over the body
limit, `415` for a non-JSON content type, `400` for malformed JSON.

## Strings in, types out

Path parameters and query values arrive as strings. A query key that repeats arrives as an array of
strings:

| Request        | What the `query` schema receives |
| -------------- | -------------------------------- |
| `?page=2`      | `{ page: '2' }`                  |
| `?tag=a&tag=b` | `{ tag: ['a', 'b'] }`            |
| (no query)     | `{}`                             |

Converting is the schema's job, so you always decide what is valid:

```ts
const Paging = v.object({
  page: v.optional(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1)), '1'),
});
const UserId = v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/), v.transform(Number)) });

route({
  method: 'GET',
  path: '/:id',
  schema: { params: UserId, query: Paging },
  handler: (ctx) => service.page(ctx.input.params.id, ctx.input.query.page), // both numbers
});
```

With Zod, the same is `z.coerce.number().int().min(1)`.

## Typed path parameters

`route()` also types `ctx.params` from the path, with no schema needed:

```ts
route({
  method: 'GET',
  path: '/:userId/posts/:postId',
  handler: (ctx) => `${ctx.params.userId} / ${ctx.params.postId}`, // both string
});
```

Using a parameter that is not in the path is a compile error. A controller prefix's parameters
are not part of the route's path type; read them with `ctx.params['name']`.

## When validation fails

Avi.js checks params, query and body, collects **every** issue, and answers `400`:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": {
    "issues": [
      { "in": "params", "path": ["id"], "message": "Invalid format" },
      { "in": "body", "path": ["name"], "message": "name is required" }
    ]
  }
}
```

The handler does not run. To use another format, read `error.details` in your
[`errorHandler`](05-request-pipeline.md#custom-error-responses). You can attach `details` to your
own errors too: `new HttpError(409, 'Email taken', { details: { field: 'email' } })`. Details are
only sent for 4xx errors.

## Where validation runs

```text
route match → middleware → guards → validation → handler → response schema → response
```

A request that a guard rejects never has its body read or validated.

## Response schemas

A `response` schema checks what the handler returns and sends the schema's **output**. Fields the
schema does not declare are dropped, so internal data cannot leak by accident:

```ts
const PublicUser = v.object({ id: v.number(), name: v.string() });

route({
  method: 'GET',
  path: '/me',
  schema: { response: PublicUser },
  handler: (ctx) => service.findWithSecrets(ctx.state.user!.id), // passwordHash is dropped
});
```

With a response schema, TypeScript also checks the handler's return type. If the value does not
match at runtime, that is a bug: Avi.js logs it and answers `500`. Status and headers from
`reply()` are kept.

## With decorators

Route decorators take the same `schema`:

```ts
@Controller('/users')
class UsersController {
  @Post('/', { schema: { body: CreateUser, response: PublicUser } })
  create(ctx: Context<{ body: v.InferOutput<typeof CreateUser> }>) {
    return reply(this.users.create(ctx.input.body), { status: 201 });
  }

  @Get('/:id', { schema: { params: UserId } })
  one(ctx: Context<{ params: { id: number } }, { id: string }>) {
    return this.users.find(ctx.input.params.id);
  }
}
```

Decorators cannot change a method's parameter types, so annotate `ctx`: the first type argument is
`ctx.input`, the second `ctx.params`. If the annotation does not match the schema, TypeScript
reports an error on the decorator.

## JavaScript

Everything above works the same without TypeScript: invalid input gets the same `400`, and
response schemas filter the same way. You only lose the inferred types.

## Next

[Chapter 7: Running in production](07-production.md).
