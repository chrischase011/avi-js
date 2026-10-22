# 12. Coming from NestJS

> **Status: Runnable.** A guide for moving a NestJS app to Avi.js, one feature at a time.

Avi.js keeps NestJS's shape: modules, controllers, providers and constructor injection. What
changes is how dependencies are declared, how handlers read the request, and what is checked at
startup.

## The same feature, before and after

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
  static inject = [Database, CONFIG] as const;
  constructor(
    private readonly db: Database,
    private readonly config: Config,
  ) {}
}

@Controller('/users')
export class UsersController {
  static inject = [UsersService] as const;
  constructor(private readonly users: UsersService) {}

  @Get('/:id', { schema: { params: UserId } })
  findOne(ctx: Context<{ params: { id: number } }>) {
    return this.users.findOne(ctx.input.params.id);
  }

  @Post('/', { schema: { body: CreateUser } })
  create(ctx: Context<{ body: CreateUserDto }>) {
    return reply(this.users.create(ctx.input.body), { status: 201 });
  }
}
```

## Translation table

| NestJS                                          | Avi.js                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `reflect-metadata`, `emitDecoratorMetadata`     | Not needed                                                                       |
| `experimentalDecorators: true`                  | Turn it **off**; Avi uses standard decorators                                    |
| Constructor types found by reflection           | `static inject = [...] as const`, checked by TypeScript                          |
| `@Inject(TOKEN)` on a parameter                 | List `TOKEN` in `static inject`                                                  |
| String tokens (`'CONFIG'`)                      | `createToken<Config>('CONFIG')`                                                  |
| `@Param()`, `@Query()`, `@Body()`, `@Headers()` | `ctx.params`, `ctx.query`, `ctx.json()`, `ctx.headers`, or validated `ctx.input` |
| `ValidationPipe` + class-validator DTOs         | Route `schema` with any Standard Schema library                                  |
| `ParseIntPipe`                                  | Conversion in the schema (`v.transform(Number)`, `z.coerce.number()`)            |
| `@HttpCode(201)`, `@Header()`                   | `reply(value, { status: 201, headers })`                                         |
| `@Res()` + `res.send()`                         | Return a value, a stream or a web `Response`                                     |
| `NestMiddleware`, `app.use()`                   | Middleware functions or classes, at app, module, controller or route level       |
| `CanActivate` guards, `@UseGuards()`            | Guards returning `true`, `@UseGuards()`                                          |
| Interceptors                                    | Middleware: `await next()` returns the handler's result                          |
| Exception filters                               | `errorHandler` (one, app-wide)                                                   |
| `@Global()` modules                             | Not supported: import what you use                                               |
| `forwardRef()`                                  | Not supported: cycles are startup errors                                         |
| `onModuleInit` / `onModuleDestroy`              | Async factories / `Symbol.asyncDispose` or `dispose`                             |
| Request-scoped providers                        | Not yet: use `ctx.state` for per-request data                                    |
| `Test.createTestingModule().overrideProvider()` | `createTestClient(AppModule, { overrides })`                                     |
| `@nestjs/swagger`                               | `@avi/openapi`                                                                   |
| Express or Fastify underneath                   | Native `node:http`                                                               |

## Migrating step by step

1. **Turn off `experimentalDecorators` and `emitDecoratorMetadata`.** Remove `reflect-metadata`.
2. **Add `static inject` to every injectable class and controller.** Run `avi check`: it reports
   every list that does not match its constructor, with file and line.
3. **Replace parameter decorators with `ctx`.** Start with `ctx.params['id']`, then add schemas
   to get typed `ctx.input`.
4. **Replace pipes with route schemas** and `@HttpCode` / `@Header` with `reply()`.
5. **Turn interceptors into middleware** and exception filters into one `errorHandler`.
6. **Start the app.** Every missing provider, bad export, cycle and route conflict is reported at
   startup with the module and the full dependency chain, before the server listens.

Explicit and decorator code can live side by side, so you can also move one feature at a time to
the explicit API with `defineController` and `defineModule`.

## Next

Back to the [tutorial index](README.md).
