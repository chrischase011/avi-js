# Examples

Each example is a small, complete app that you can read top to bottom and run.

| Example                    | Shows                                                                               | Style      |
| -------------------------- | ----------------------------------------------------------------------------------- | ---------- |
| [basic-api](basic-api)     | The smallest app: routes, a service, errors                                         | Explicit   |
| [modular-api](modular-api) | The modular layout: feature modules, controllers, services                          | Decorators |
| [crud-api](crud-api)       | Full CRUD with validation, paging, filters, a swappable repository and tests        | Decorators |
| [auth-api](auth-api)       | Sign-in, guards, roles, a request-scoped current user, CORS and security headers    | Explicit   |
| [workers-api](workers-api) | Every CPU core with `cluster()`, a background worker with `runWorker()`             | Explicit   |
| [prisma-api](prisma-api)   | Prisma ORM 7 with SQLite: a managed client, relations, Prisma errors as HTTP errors | Decorators |

The first four and workers-api are part of the workspace and run in CI (`pnpm examples`). From the repository root:

```sh
pnpm install
pnpm build
pnpm --filter @avijs/example-crud-api start
```

`prisma-api` is a standalone app that installs Avi.js from npm; see its README.
