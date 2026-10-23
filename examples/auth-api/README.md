# Auth API example

Sign-in, protected routes and roles, written with the explicit API (no decorators).

| Route              | Who                                     | Does                                         |
| ------------------ | --------------------------------------- | -------------------------------------------- |
| `POST /auth/login` | anyone                                  | `{ username, password }` → `{ token, user }` |
| `GET /me`          | signed in                               | The current user                             |
| `GET /admin/stats` | signed in, role `superadmin` or `admin` | `{ users }`                                  |

Demo users: `shiela` / `my-love-forever` (superadmin), `ada` / `analytical-engine` (admin) and
`grace` / `cobol-forever` (member).

What it shows:

- **A class guard with dependencies.** `AuthGuard` injects `TokenService`, checks the
  `Authorization: Bearer` header, answers `401` with `WWW-Authenticate`, and stores the user on
  `ctx.state.user` (typed through `AviState`).
- **A guard factory.** `requireRole('admin')` turns into `403` for other users.
- **Request scope.** `CURRENT_USER` is a request-scoped provider built from `REQUEST`, so `/me`
  injects the signed-in user like any other dependency.
- **`@avijs/security`.** `securityHeaders()` and `cors()` with credentials for one browser origin.
- **Passwords and tokens with `node:crypto` only**: scrypt hashes, constant-time comparisons and
  HMAC-signed tokens with an expiry. Fine for learning; in production, prefer a maintained JWT or
  session library and keep users in a database.

```text
src/
├── main.ts               reads AUTH_SECRET, CORS_ORIGIN and PORT
├── app.ts                createApp(): hooks, providers and controllers
├── auth/
│   ├── users.ts          demo users, password checks, AviState typing
│   ├── tokens.ts         TokenService and the AUTH_SECRET token
│   ├── guards.ts         AuthGuard and requireRole()
│   └── current-user.ts   the request-scoped CURRENT_USER provider
└── routes/
    ├── auth.ts
    ├── me.ts
    └── admin.ts
```

Run it from the repository root:

```sh
pnpm build
AUTH_SECRET=change-me pnpm --filter @avijs/example-auth-api start
curl -X POST localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"username":"ada","password":"analytical-engine"}'
curl localhost:3000/me -H "authorization: Bearer <token from the login>"
```
