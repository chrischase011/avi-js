# Prisma example

Users and posts in SQLite with [Prisma ORM 7](https://www.prisma.io), written with decorators. It
installs Avi.js from npm, like your own app would.

| Route                      | Does                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `GET /users`               | All users                                                    |
| `GET /users/:id`           | One user with their posts, or `404`                          |
| `POST /users`              | `{ email, name }`, `201`; `409` if the email is taken        |
| `GET /posts?published=`    | Posts with their author, optionally only published or drafts |
| `POST /posts`              | `{ authorId, title, content? }`, `201`; `404` for no author  |
| `PATCH /posts/:id/publish` | Publishes a post                                             |
| `DELETE /posts/:id`        | Deletes a post, `204`                                        |

## Run it

```sh
cd examples/prisma-api
npm install
npx prisma generate     # writes the client to src/generated/prisma
npm run db:migrate      # creates dev.db from prisma/migrations
npm run build
npm start               # http://localhost:3000
```

`npm run smoke` exercises every route against the database. Set `DATABASE_URL` to use another file,
for example `DATABASE_URL=file:./test.db`.

npm 11 asks before running install scripts. `package.json` approves the two Prisma needs in
`allowScripts`; nothing else runs scripts.

## How it fits together

```text
prisma/
├── schema.prisma          models and the prisma-client generator
└── migrations/
prisma.config.ts           schema path and DATABASE_URL
src/
├── main.ts
├── app.module.ts
├── config.ts              PORT and DATABASE_URL, validated at startup
├── prisma.module.ts       PrismaClient from the config (defineFactory) + error mapping
├── schemas.ts             shared Valibot schemas
├── users/                 module, controller, service
└── posts/                 module, controller, service
```

**One client, managed by the container.** `PrismaModule` provides `PrismaClient` with an async
factory, so the database is connected before the server accepts requests, and `dispose` calls
`$disconnect()` when `app.close()` runs. Services inject it like any class:

```ts
@Injectable()
export class PostsService {
  static inject = [PrismaClient] as const;
  constructor(private readonly prisma: PrismaClient) {}
}
```

`UsersModule` and `PostsModule` both import `PrismaModule`; it is still created once.

**Errors.** `httpError()` turns the Prisma errors a client can cause into HTTP errors: a missing
record (`P2025`) or foreign key (`P2003`) becomes `404`, a unique conflict (`P2002`) becomes `409`.
Everything else stays a generic `500`, and the details go to the log, not the client.

**Validation.** Route schemas check bodies, path ids and the `published` query flag before the
service runs, so Prisma only sees valid input.

**Driver.** The example uses the libSQL adapter (`@prisma/adapter-libsql`), which ships prebuilt
binaries. For PostgreSQL, swap the datasource provider and use `@prisma/adapter-pg`; nothing in the
Avi.js code changes.

## Checking inject lists

`npx avi check` verifies every `static inject` list against its constructor, including the
generic `PrismaClient`.
