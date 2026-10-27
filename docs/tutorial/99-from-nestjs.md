# Avi.js for NestJS developers

> **Status: Runnable.** A map of familiar NestJS ideas to their Avi.js equivalents.

Avi.js is inspired by [NestJS](https://nestjs.com), and the name is a nod to it: birds live in
nests. NestJS showed how well modules, controllers, providers and dependency injection organize a
Node.js backend, and Avi.js builds on those ideas. If you know NestJS, you already know most of
Avi.js.

The two projects make different trade-offs. NestJS has a large ecosystem, many integrations and
years of production use. Avi.js explores a smaller core: explicit dependency lists instead of
reflection, standard decorators, and an optional decorator-free API. This page shows how the
familiar concepts translate, so you can feel at home quickly.

## The same feature in both

**NestJS**

```ts
@Injectable()
export class UsersService {
  constructor(
    private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
  ) {}
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.users.findOne(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }
}
```

**Avi.js**

```ts
@Injectable()
export class UsersService {
  // CONFIG is not named like its type Config, so this class lists what it needs.
  static inject = [Database, CONFIG] as const;
  constructor(
    private readonly db: Database,
    private readonly config: Config,
  ) {}
}

const findOne = { params: UserId } satisfies RouteSchema;
const create = { body: CreateUser } satisfies RouteSchema;

@Controller('/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('/:id', { schema: findOne })
  findOne(ctx: RouteContext<typeof findOne>) {
    return this.users.findOne(ctx.input.params.id);
  }

  @Post('/', { schema: create })
  create(ctx: RouteContext<typeof create>) {
    return reply(this.users.create(ctx.input.body), { status: 201 });
  }
}
```

The structure is the same: an injectable service, a controller with routes, and constructor
injection. The differences are in how dependencies are declared and how a handler reads the
request.

## Concept map

| In NestJS                                       | In Avi.js                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `reflect-metadata`, `emitDecoratorMetadata`     | `avi dev` generates the lists from constructor types, or `static inject`         |
| `experimentalDecorators: true`                  | Standard TC39 decorators; leave `experimentalDecorators` off                     |
| `@Inject(TOKEN)` on a parameter                 | A token named like the type is inferred; otherwise list it in `static inject`    |
| String or symbol tokens                         | `createToken<Config>('CONFIG')`, typed                                           |
| `@Param()`, `@Query()`, `@Body()`, `@Headers()` | `ctx.params`, `ctx.query`, `ctx.json()`, `ctx.headers`, or validated `ctx.input` |
| `ValidationPipe` with DTO classes               | A route `schema` from any Standard Schema library                                |
| `ParseIntPipe`                                  | Conversion inside the schema (`v.transform(Number)`, `z.coerce.number()`)        |
| `@HttpCode()`, `@Header()`                      | `reply(value, { status, headers })`                                              |
| `@Res()`                                        | Return a value, a stream or a web `Response`                                     |
| Middleware                                      | Middleware functions or classes, at app, module, controller or route level       |
| Guards, `@UseGuards()`                          | Guards returning `true`, `@UseGuards()`                                          |
| Interceptors                                    | Middleware: `await next()` returns the handler's result                          |
| Exception filters                               | One app-wide `errorHandler`                                                      |
| `@Global()` modules                             | Imports are always explicit                                                      |
| `forwardRef()`                                  | Dependency cycles are reported at startup instead                                |
| `onModuleInit`, `onModuleDestroy`               | Async factories, `Symbol.asyncDispose` or a `dispose` callback                   |
| Request-scoped providers                        | `scope: 'request'` and the `REQUEST` token                                       |
| `Test.createTestingModule().overrideProvider()` | `createTestClient(AppModule, { overrides })`                                     |
| `@nestjs/swagger`                               | `@avijs/openapi`                                                                 |
| Express or Fastify adapter                      | Native `node:http`                                                               |

## Trying Avi.js with NestJS experience

These steps help if you want to rebuild a feature you know from NestJS in Avi.js:

1. **Use standard decorators.** Leave `experimentalDecorators` and `emitDecoratorMetadata` off.
2. **Keep constructors as they are.** `avi dev` infers each class's dependencies into
   `src/inject.gen.ts`, and warns (`AVI201`) about a parameter it cannot infer, such as a string
   token: list that class's dependencies in `static inject`, which `avi check` confirms.
3. **Read request data from `ctx`.** Start with `ctx.params['id']`, then add a route schema for typed
   `ctx.input`.
4. **Use `reply()`** for status codes and headers.
5. **Turn cross-cutting logic into middleware or guards**, and errors into one `errorHandler`.
6. **Start the app.** Missing providers, export problems, cycles and route conflicts are reported at
   startup, with the module and the dependency chain.

The explicit API (`defineController`, `defineModule`) works alongside decorators, so you can use
whichever style suits each part of an app.

## Next

Back to the [tutorial index](README.md).
