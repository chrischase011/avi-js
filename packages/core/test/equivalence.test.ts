// The same app written with the explicit API and with decorators must behave identically.
import { afterEach, describe, expect, it } from 'vitest';
import {
  Controller,
  Delete,
  Get,
  HttpError,
  Injectable,
  Module,
  Post,
  createAvi,
  createToken,
  defineController,
  defineModule,
  reply,
  type AviApp,
  type Context,
} from '../src/index.js';

interface User {
  id: number;
  name: string;
}
interface GreeterConfig {
  greeting: string;
}

const Events = createToken<string[]>('Events');
const GreeterConfig = createToken<GreeterConfig>('GreeterConfig');

interface Built {
  app: AviApp;
  events: string[];
}

function explicitApp(): Built {
  const events: string[] = [];

  class Db {
    static inject = [Events] as const;
    readonly users: User[] = [{ id: 1, name: 'Ada' }];
    constructor(private readonly log: string[]) {}
    [Symbol.dispose]() {
      this.log.push('db disposed');
    }
  }

  class UsersService {
    static inject = [Db] as const;
    constructor(private readonly db: Db) {}
    all() {
      return this.db.users;
    }
    find(id: string) {
      return this.db.users.find((u) => String(u.id) === id);
    }
    add(name: string) {
      const user = { id: this.db.users.length + 1, name };
      this.db.users.push(user);
      return user;
    }
  }

  class GreetingService {
    static inject = [GreeterConfig] as const;
    constructor(private readonly config: GreeterConfig) {}
    greet(name: string) {
      return `${this.config.greeting}, ${name}!`;
    }
  }

  const GreetingModule = defineModule({
    name: 'GreetingModule',
    providers: [GreetingService, { provide: GreeterConfig, useValue: { greeting: 'Hello' } }],
    exports: [GreetingService],
  });

  const users = defineController({
    prefix: '/users',
    inject: [UsersService],
    routes: (service) => [
      { method: 'GET', path: '/', handler: () => service.all() },
      { method: 'GET', path: '/me', handler: () => ({ id: 'me' }) },
      {
        method: 'GET',
        path: '/:id',
        handler: (ctx) => {
          const user = service.find(ctx.params['id'] ?? '');
          if (!user) throw new HttpError(404, 'User not found');
          return user;
        },
      },
      {
        method: 'POST',
        path: '/',
        handler: async (ctx) => {
          const body = (await ctx.json()) as { name?: unknown };
          if (typeof body.name !== 'string') throw new HttpError(400, 'name is required');
          const user = service.add(body.name);
          return reply(user, {
            status: 201,
            headers: { location: `/api/users/${String(user.id)}` },
          });
        },
      },
      { method: 'DELETE', path: '/:id', handler: () => undefined },
    ],
  });

  const greet = defineController({
    prefix: '/greet',
    inject: [GreetingService],
    routes: (greeter) => [
      {
        method: 'GET',
        path: '/:name',
        handler: (ctx) => ({ message: greeter.greet(ctx.params['name'] ?? '') }),
      },
    ],
  });

  const AppModule = defineModule({
    name: 'AppModule',
    prefix: '/api',
    imports: [GreetingModule],
    providers: [Db, UsersService, { provide: Events, useValue: events }],
    controllers: [users, greet],
  });

  return { app: createAvi().register(AppModule), events };
}

function decoratedApp(): Built {
  const events: string[] = [];

  @Injectable()
  class Db {
    static inject = [Events] as const;
    readonly users: User[] = [{ id: 1, name: 'Ada' }];
    constructor(private readonly log: string[]) {}
    [Symbol.dispose]() {
      this.log.push('db disposed');
    }
  }

  @Injectable()
  class UsersService {
    static inject = [Db] as const;
    constructor(private readonly db: Db) {}
    all() {
      return this.db.users;
    }
    find(id: string) {
      return this.db.users.find((u) => String(u.id) === id);
    }
    add(name: string) {
      const user = { id: this.db.users.length + 1, name };
      this.db.users.push(user);
      return user;
    }
  }

  @Injectable()
  class GreetingService {
    static inject = [GreeterConfig] as const;
    constructor(private readonly config: GreeterConfig) {}
    greet(name: string) {
      return `${this.config.greeting}, ${name}!`;
    }
  }

  @Module({
    providers: [GreetingService, { provide: GreeterConfig, useValue: { greeting: 'Hello' } }],
    exports: [GreetingService],
  })
  class GreetingModule {}

  @Controller('/users')
  class UsersController {
    static inject = [UsersService] as const;
    constructor(private readonly service: UsersService) {}

    @Get()
    all() {
      return this.service.all();
    }

    @Get('/me')
    me() {
      return { id: 'me' };
    }

    @Get('/:id')
    one(ctx: Context) {
      const user = this.service.find(ctx.params['id'] ?? '');
      if (!user) throw new HttpError(404, 'User not found');
      return user;
    }

    @Post()
    async create(ctx: Context) {
      const body = (await ctx.json()) as { name?: unknown };
      if (typeof body.name !== 'string') throw new HttpError(400, 'name is required');
      const user = this.service.add(body.name);
      return reply(user, { status: 201, headers: { location: `/api/users/${String(user.id)}` } });
    }

    @Delete('/:id')
    remove() {
      return undefined;
    }
  }

  @Controller('/greet')
  class GreetController {
    static inject = [GreetingService] as const;
    constructor(private readonly greeter: GreetingService) {}

    @Get('/:name')
    greet(ctx: Context) {
      return { message: this.greeter.greet(ctx.params['name'] ?? '') };
    }
  }

  @Module({
    prefix: '/api',
    imports: [GreetingModule],
    providers: [Db, UsersService, { provide: Events, useValue: events }],
    controllers: [UsersController, GreetController],
  })
  class AppModule {}

  return { app: createAvi().register(AppModule), events };
}

const running: AviApp[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()));
});

async function serve(build: () => Built) {
  const built = build();
  running.push(built.app);
  const { port } = await built.app.listen(0, '127.0.0.1');
  return { ...built, url: `http://127.0.0.1:${String(port)}/api` };
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe.each([
  ['explicit API', explicitApp],
  ['decorator API', decoratedApp],
])('%s', (_, build) => {
  it('serves routes with params and static precedence', async () => {
    const { url } = await serve(build);
    expect(await (await fetch(`${url}/users`)).json()).toEqual([{ id: 1, name: 'Ada' }]);
    expect(await (await fetch(`${url}/users/me`)).json()).toEqual({ id: 'me' });
    expect(await (await fetch(`${url}/users/1`)).json()).toEqual({ id: 1, name: 'Ada' });
  });

  it('injects services from imported modules', async () => {
    const { url } = await serve(build);
    expect(await (await fetch(`${url}/greet/Grace`)).json()).toEqual({ message: 'Hello, Grace!' });
  });

  it('handles bodies, status codes and errors the same way', async () => {
    const { url } = await serve(build);

    const created = await fetch(`${url}/users`, json({ name: 'Grace' }));
    expect(created.status).toBe(201);
    expect(created.headers.get('location')).toBe('/api/users/2');

    expect((await fetch(`${url}/users`, json({}))).status).toBe(400);
    expect(await (await fetch(`${url}/users/99`)).json()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'User not found',
    });
    expect((await fetch(`${url}/users/1`, { method: 'DELETE' })).status).toBe(204);

    const wrong = await fetch(`${url}/users`, { method: 'PUT' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');
  });

  it('disposes providers after the server closes', async () => {
    const { app, events } = await serve(build);
    await app.close();
    expect(events).toEqual(['db disposed']);
  });
});

describe('explicit and decorator apps', () => {
  it('give byte-identical responses', async () => {
    const explicit = await serve(explicitApp);
    const decorated = await serve(decoratedApp);
    const requests: [string, RequestInit?][] = [
      ['/users'],
      ['/users/me'],
      ['/users/1'],
      ['/users/42'],
      ['/users/', { method: 'HEAD' }],
      ['/users', { method: 'OPTIONS' }],
      ['/users', { method: 'PATCH' }],
      ['/users', json({ name: 'Linus' })],
      ['/users', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }],
      ['/greet/%C3%89mile'],
      ['/nope'],
    ];

    const snapshot = async (base: string) => {
      const results = [];
      for (const [path, init] of requests) {
        const res = await fetch(`${base}${path}`, init);
        const headers = Object.fromEntries(
          [...res.headers].filter(([name]) => !['date', 'keep-alive', 'connection'].includes(name)),
        );
        results.push({ path, status: res.status, headers, body: await res.text() });
      }
      return results;
    };

    expect(await snapshot(decorated.url)).toEqual(await snapshot(explicit.url));
  });
});
