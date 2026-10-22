# 2. Routing

> **Status: Runnable.** Everything on this page works today.

## Parameters

A segment starting with `:` captures one path segment:

```ts
const users = defineController({
  prefix: '/users',
  routes: [
    { method: 'GET', path: '/', handler: (ctx) => ({ page: ctx.query.get('page') ?? '1' }) },
    { method: 'GET', path: '/:id', handler: (ctx) => ({ id: ctx.params['id'] }) },
    {
      method: 'GET',
      path: '/:id/posts/:postId',
      handler: (ctx) => ({ user: ctx.params['id'], post: ctx.params['postId'] }),
    },
  ],
});
```

```sh
curl "localhost:3000/users?page=2"     # {"page":"2"}
curl localhost:3000/users/42           # {"id":"42"}
curl localhost:3000/users/42/posts/7   # {"user":"42","post":"7"}
```

- Values are strings and are percent-decoded: `/users/caf%C3%A9` gives `id: 'café'`.
- The path is split on `/` **before** decoding, so `%2F` inside a value stays part of it:
  `/files/a%2Fb` gives `name: 'a/b'`.
- A parameter never matches an empty segment.
- In a plain route object, `ctx.params` is a `Record<string, string>`: write `ctx.params['id']`.
  Wrap the route in `route({...})` and `ctx.params.id` is typed from the path; see
  [Chapter 6](06-validation.md#typed-path-parameters).

## Catch-all

A trailing `*` matches the rest of the path, including nothing at all:

```ts
{ method: 'GET', path: '/files/*', handler: (ctx) => ({ file: ctx.params['*'] }) }
```

```sh
curl localhost:3000/files/docs/a%20b.txt   # {"file":"docs/a b.txt"}
curl localhost:3000/files                  # {"file":""}
```

`*` must be the whole last segment. It never matches a remainder that contains an empty segment
(`/files//etc`), but it does pass `..` through literally. **Never join `params['*']` onto a file
system path without checking it.**

## Which route wins

At each segment, a static segment beats a parameter, which beats a catch-all. Registration order
never matters.

```ts
defineController({
  prefix: '/users',
  routes: [
    { method: 'GET', path: '/*', handler: () => 'anything' },
    { method: 'GET', path: '/:id', handler: () => 'some user' },
    { method: 'GET', path: '/me', handler: () => 'you' },
  ],
});
```

| Request       | Route  |
| ------------- | ------ |
| `/users/me`   | `/me`  |
| `/users/42`   | `/:id` |
| `/users/42/x` | `/*`   |

If the more specific branch has no route for the request, the router backs up and tries the next
option. With `GET /users/me/posts` and `GET /users/:id/settings`, a request for
`/users/me/settings` reaches `/:id/settings` with `id: 'me'`. The same happens per method: with
`GET /users/me` and `DELETE /users/:id`, `DELETE /users/me` reaches the `DELETE` route.

## Paths are matched exactly, almost

| Request         | Treated as                                  |
| --------------- | ------------------------------------------- |
| `/users/`       | `/users` (one trailing slash is ignored)    |
| `/Users`        | different from `/users` (case-sensitive)    |
| `/users//42`    | `404` (empty segments are never collapsed)  |
| `/users/%E0%A4` | `400` (malformed encoding, no handler runs) |
| `/users/..`     | `id: '..'` (dot segments are not resolved)  |

Static segments in route definitions are decoded too, so `/caf%C3%A9` and `/café` are the same
route. To match a literal `%`, write it as `%25`.

## 404, 405, HEAD and OPTIONS

| Request                       | Response                                                   |
| ----------------------------- | ---------------------------------------------------------- |
| Path matches nothing          | `404`                                                      |
| Path matches, method does not | `405` with `Allow: GET, HEAD, POST, OPTIONS` (for example) |
| `HEAD` on a `GET` route       | The `GET` handler runs; same status and headers, no body   |
| `OPTIONS` on a known path     | `204` with an `Allow` header                               |

An explicit `HEAD` or `OPTIONS` route always takes priority over the automatic behavior. CORS is
not handled here; it comes with the security package later.

## Conflicts fail at startup

The app refuses to start (`init()` and `listen()` reject) when:

- the same method and path are registered twice, including `/a` and `/a/`
- two routes use different parameter names at the same position, such as `/users/:id` and
  `/users/:userId/posts`. Pick one name per position.
- a parameter name is not a valid identifier, or repeats within one path
- `*` is not the whole last segment
- a path has an empty segment or malformed percent-encoding

## Groups

A controller's `prefix` groups its routes. `register()` takes a `prefix` too, for app-wide groups
such as API versions:

```ts
app.register({ prefix: '/api/v1', controllers: [users, posts] });
app.register({ controllers: [health] });
// /api/v1/users, /api/v1/posts, /health
```

## Next

[Chapter 3: Modules and dependency injection](03-modules-and-di.md).
