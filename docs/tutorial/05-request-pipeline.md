# 5. Middleware, guards and errors

> **Status: Runnable.** Everything on this page works today. Validation joins the pipeline in
> [Chapter 6](06-validation.md).

## The request pipeline

Every request passes through the same stages, in this order:

```text
route match → middleware → guards → handler → serialization → response
              └──────── any error → errorHandler → safe error response ─┘
```

Middleware and guards can be attached at four levels. They always run in this order:
**app → module → controller → route**.

```ts
const app = createAvi({ middleware: [requestId], guards: [] }); // app

defineModule({ middleware: [audit], controllers: [users] }); // module: its own controllers

defineController({
  prefix: '/users',
  middleware: [timing], // controller
  routes: [
    { method: 'DELETE', path: '/:id', guards: [isAdmin], handler: remove }, // route
  ],
});
```

Each route's chain is assembled once at startup. Routes without middleware or guards call the
handler directly.

## Middleware

Middleware wraps everything after it. `await next()` runs the rest of the pipeline and returns the
handler's result:

```ts
import type { Middleware } from '@avijs/core';

const requestId: Middleware = async (ctx, next) => {
  ctx.setHeader('x-request-id', crypto.randomUUID());
  return next();
};

const envelope: Middleware = async (_ctx, next) => ({ data: await next() });
```

- **Return without calling `next()`** to answer early. Guards and the handler never run.
- **Calling `next()` twice** is a bug and fails the request with a 500.
- **Throwing** works like throwing in a handler.

```ts
const cache: Middleware = (ctx, next) => {
  const hit = store.get(ctx.path);
  return hit ? reply(hit, { headers: { 'x-cache': 'hit' } }) : next();
};
```

### Response headers

`ctx.setHeader(name, value)` adds a header to whatever response the request ends with, including
error responses. If `reply()` or an `HttpError` sets the same header, theirs wins.

### Request state

`ctx.state` is a fresh object for every request, for passing data along the pipeline. Give it types
once for your whole app:

```ts
declare module '@avijs/core' {
  interface AviState {
    user?: { id: string; role: 'admin' | 'member' };
  }
}

// later, in a handler
ctx.state.user?.id; // typed
```

## Guards

A guard decides whether a request may reach the handler. Return `true` to allow it; anything else
answers **403 Forbidden**. Throw an `HttpError` for other answers, such as 401:

```ts
import { HttpError, type Guard } from '@avijs/core';

const signedIn: Guard = (ctx) => {
  if (!ctx.state.user) {
    throw new HttpError(401, 'Sign in first', { headers: { 'www-authenticate': 'Bearer' } });
  }
  return true;
};

const isAdmin: Guard = (ctx) => ctx.state.user?.role === 'admin';
```

Guards run after all middleware, so authentication middleware can set `ctx.state.user` first.

Behind `signedIn`, the user is always there, but `ctx.state.user` is still typed as optional, since
the type cannot know which guards a route has. `ctx.need('user')` (from 0.7.0) returns it without
`undefined`:

```ts
@Get('/me')
@UseGuards(signedIn)
me(ctx: Context) {
  return ctx.need('user'); // { id: string; role: 'admin' | 'member' }
}
```

If the value is missing, because the route lacks the guard that sets it, `ctx.need` throws: the
client gets a 500 and the log says `ctx.state.user is not set: is a guard missing on this route?`.

## Classes with dependencies

Middleware and guards can be classes with `use(ctx, next)` or `canActivate(ctx)`. Avi.js builds
each class once per app with its `static inject`, resolved from the module where it is attached.
You do not list them in `providers`.

```ts
class AuthMiddleware {
  static inject = [SessionStore] as const;
  constructor(private readonly sessions: SessionStore) {}

  async use(ctx: Context, next: Next) {
    const token = ctx.headers.authorization?.replace('Bearer ', '');
    if (token) ctx.state.user = await this.sessions.find(token);
    return next();
  }
}

defineModule({
  providers: [SessionStore],
  middleware: [AuthMiddleware],
  controllers: [users],
});
```

## With decorators

`@UseMiddleware(...)` and `@UseGuards(...)` work on a controller class or on one method:

```ts
@Controller('/admin')
@UseMiddleware(AuthMiddleware)
@UseGuards(signedIn)
class AdminController {
  @Get('/stats')
  stats() {
    return { users: 42 };
  }

  @Delete('/users/:id')
  @UseGuards(isAdmin)
  remove(ctx: Context) {
    return undefined;
  }
}
```

## Custom error responses

By default, errors become `{ statusCode, error, message? }` and 5xx details never reach the client.
To use another format, such as `application/problem+json`, pass an `errorHandler`. It receives
every error, including 404 and 405, and returns a response value like a handler:

```ts
const app = createAvi({
  errorHandler: (error, ctx) =>
    reply(
      {
        type: 'about:blank',
        title: error instanceof HttpError && error.status < 500 ? error.message : 'Server error',
        instance: ctx.path,
      },
      { headers: { 'content-type': 'application/problem+json' } },
    ),
});
```

- Without its own status, the response uses the error's: `HttpError.status`, otherwise 500.
- Headers from the error (such as `allow` on a 405) are kept.
- 5xx errors are still logged before your handler runs.
- If `errorHandler` itself throws, Avi.js logs that too and sends its built-in safe response.

## Watching responses

Middleware cannot see the final status, because serialization happens after it. For logs and
metrics, use `onResponse`. It runs after every response:

```ts
createAvi({
  onResponse: ({ method, path, route, status, duration, aborted }) => {
    logger.info({ method, path, route, status, ms: duration.toFixed(1), aborted });
  },
});
```

`route` is the matched pattern, such as `/users/:id`, so you can group metrics by route. Errors
thrown in `onResponse` are logged and never affect the response.

## Requests never share state

Each request gets its own `ctx`, `ctx.state` and headers. The test suite runs 150 overlapping
requests through the same middleware and checks that none sees another's data.

## Next

[Chapter 6: Validation](06-validation.md).
