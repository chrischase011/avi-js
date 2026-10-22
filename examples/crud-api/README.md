# CRUD API example

A tasks API with every CRUD operation, written with decorators.

| Route               | Does                                                       |
| ------------------- | ---------------------------------------------------------- |
| `GET /tasks`        | Lists tasks. Query: `status`, `limit` (max 100), `offset`  |
| `GET /tasks/:id`    | One task, or `404`                                         |
| `POST /tasks`       | Creates a task from `{ title, status? }`, `201` + Location |
| `PATCH /tasks/:id`  | Updates `title` and/or `status`                            |
| `DELETE /tasks/:id` | Deletes, `204`                                             |

What it shows:

- **Validation** with Valibot route schemas: params and query converted from strings, bodies
  trimmed and checked, every issue reported in one `400`.
- **A repository behind a token.** `TasksService` depends on `TASKS_REPOSITORY`, not on a class, so
  you can swap the in-memory store for a database in `tasks.module.ts`, or in tests with
  `overrides`. The [Prisma example](../prisma-api) does exactly that with a real database.
- **Errors**: the service throws `HttpError(404)`; Avi.js turns it into a JSON response.
- **Testing** with `@avijs/testing` in `src/smoke.ts`.

```text
src/
├── main.ts
├── app.module.ts
└── tasks/
    ├── tasks.module.ts
    ├── tasks.controller.ts
    ├── tasks.service.ts
    ├── tasks.repository.ts   token, interface and in-memory store
    └── task.schema.ts        Valibot schemas and types
```

Run it from the repository root:

```sh
pnpm build
pnpm --filter @avijs/example-crud-api start
curl -X POST localhost:3000/tasks -H 'content-type: application/json' -d '{"title":"Try Avi.js"}'
curl localhost:3000/tasks
```
