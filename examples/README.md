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

## Run in your browser

[avi-js-example-app](https://github.com/chrischase011/avi-js-example-app) is a larger app: a team
task tracker with sign-in, roles, projects, tasks, file uploads, live updates, OpenAPI, a React
frontend with the typed client, and end-to-end tests. Its main branch uses Prisma and SQLite.
StackBlitz cannot run Prisma's native engines, so this version keeps the data in memory, and the
API and the React app start together.
[Open it in a new tab](https://stackblitz.com/github/chrischase011/avi-js-example-app/tree/stackblitz?file=src/modules/tasks/tasks.service.ts).

<iframe
  src="https://stackblitz.com/github/chrischase011/avi-js-example-app/tree/stackblitz?embed=1&file=src/modules/tasks/tasks.service.ts"
  title="Avi.js example app on StackBlitz"
  loading="lazy"
  style="width: 100%; height: 600px; border: 0; border-radius: 8px"
></iframe>

The project `npm create avi` makes is in [chapter 0](https://chrischase011.github.io/avi-js/tutorial/00-getting-started#try-it-in-your-browser),
ready to edit in the browser too.
