# 2. Routing

> **Status: Planned (Phase 2).** This chapter shows the target API. The code does not run yet.

## Params and query

```ts
const users = defineController({
  prefix: '/users',
  routes: [
    { method: 'GET', path: '/', handler: (ctx) => ({ page: ctx.query.page ?? '1' }) },
    { method: 'GET', path: '/:id', handler: (ctx) => ({ id: ctx.params.id }) },
  ],
});
```

```sh
curl "localhost:3000/users?page=2"   # {"page":"2"}
curl localhost:3000/users/42         # {"id":"42"}
```

Params and query values are strings. Turning them into numbers or validated objects is the job of
validation (Chapter 6).

## Static routes win

```ts
routes: [
  { method: 'GET', path: '/me', handler: () => ({ id: 'current-user' }) },
  { method: 'GET', path: '/:id', handler: (ctx) => ({ id: ctx.params.id }) },
];
```

`GET /users/me` always matches `/me`, whatever order you register the routes in. Precedence is
deterministic: a static segment beats a parameter at the same position.

## Conflicts fail at startup

Registering `GET /users/:id` and `GET /users/:userId` is a conflict: both match the same requests.
Avi.js refuses to start and tells you which routes collide, instead of picking one silently.

## 404, 405, HEAD and OPTIONS

| Request                              | Response                                  |
| ------------------------------------ | ----------------------------------------- |
| Path matches nothing                 | `404`                                     |
| Path matches, method does not        | `405` with an `Allow` header              |
| `HEAD` on a `GET` route              | Same status and headers as `GET`, no body |
| `OPTIONS` on a known path            | `204` with an `Allow` header              |
| Malformed encoding (`/users/%E0%A4`) | `400`, the handler never runs             |

## Next

[Chapter 3: Modules and dependency injection](03-modules-and-di.md).
