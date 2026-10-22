import { afterEach, describe, expect, it } from 'vitest';
import {
  AviFactory,
  Controller,
  Get,
  Injectable,
  Module,
  REQUEST,
  createAvi,
  createToken,
  defineController,
  type AviApp,
  type Context,
} from '../src/index.js';

let app: AviApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serve(instance: AviApp): Promise<string> {
  app = instance;
  const { port } = await instance.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${String(port)}`;
}

class Counter {
  created = 0;
}

let disposed: string[] = [];

@Injectable({ scope: 'request' })
class CurrentUser {
  static inject = [REQUEST, Counter] as const;
  readonly name: string;
  constructor(ctx: Context, counter: Counter) {
    counter.created++;
    this.name = String(ctx.headers['x-user'] ?? 'anonymous');
  }
  [Symbol.dispose]() {
    disposed.push(this.name);
  }
}

@Controller('/me')
class MeController {
  static inject = [CurrentUser, CurrentUser] as const;
  constructor(
    private readonly user: CurrentUser,
    private readonly again: CurrentUser,
  ) {}

  @Get('/')
  async me() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { name: this.user.name, same: this.user === this.again };
  }
}

@Module({ controllers: [MeController], providers: [CurrentUser, Counter] })
class DecoratedModule {}

const explicit = {
  controllers: [
    defineController({
      prefix: '/me',
      inject: [CurrentUser, CurrentUser],
      routes: (user, again) => [
        {
          method: 'GET',
          path: '/',
          handler: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { name: user.name, same: user === again };
          },
        },
      ],
    }),
  ],
  providers: [CurrentUser, Counter],
};

describe.each([
  ['decorator', DecoratedModule],
  ['explicit', explicit],
] as const)('request scope (%s)', (_style, root) => {
  it('creates request providers once per request, isolated under concurrency', async () => {
    disposed = [];
    const url = await serve(await AviFactory.create(root));

    const names = Array.from({ length: 20 }, (_, i) => `user-${String(i)}`);
    const results = await Promise.all(
      names.map(async (name) => (await fetch(`${url}/me`, { headers: { 'x-user': name } })).json()),
    );

    expect(results).toEqual(names.map((name) => ({ name, same: true })));
    expect(app?.get(Counter).created).toBe(20);
    expect(disposed.sort()).toEqual([...names].sort());
  });
});

describe('request scope', () => {
  it('keeps controllers without request dependencies as singletons', async () => {
    let built = 0;
    const plain = defineController({
      inject: [Counter],
      routes: () => {
        built++;
        return [{ method: 'GET', path: '/', handler: () => 'ok' }];
      },
    });
    const url = await serve(createAvi().register({ controllers: [plain], providers: [Counter] }));
    await fetch(url);
    await fetch(url);
    expect(built).toBe(1);
  });

  it('works with request-scoped factories and transients', async () => {
    const Tenant = createToken<string>('Tenant');
    const tenantController = defineController({
      inject: [Tenant],
      routes: (tenant) => [{ method: 'GET', path: '/', handler: () => tenant }],
    });
    const url = await serve(
      createAvi().register({
        controllers: [tenantController],
        providers: [
          {
            provide: Tenant,
            useFactory: (ctx: Context) => String(ctx.headers['x-tenant']),
            inject: [REQUEST],
            scope: 'request',
          },
        ],
      }),
    );
    expect(await (await fetch(url, { headers: { 'x-tenant': 'acme' } })).text()).toBe('acme');
    expect(await (await fetch(url, { headers: { 'x-tenant': 'globex' } })).text()).toBe('globex');
  });

  it('reports a controller that uses a request dependency at startup', async () => {
    @Controller('/')
    class Eager {
      static inject = [CurrentUser] as const;
      readonly name: string;
      constructor(user: CurrentUser) {
        this.name = user.name;
      }
      @Get('/')
      get() {
        return this.name;
      }
    }
    await expect(
      AviFactory.create({ controllers: [Eager], providers: [CurrentUser, Counter] }),
    ).rejects.toThrow(
      'Eager used request-scoped CurrentUser while being created at startup. Use it inside route handlers only.',
    );
  });

  it('rejects singletons, middleware and guards that depend on request scope', async () => {
    class Audit {
      static inject = [CurrentUser] as const;
      constructor(readonly user: CurrentUser) {}
    }
    await expect(
      AviFactory.create({ name: 'App', providers: [Audit, CurrentUser, Counter] }),
    ).rejects.toThrow('Singleton Audit in App depends on request-scoped CurrentUser');

    class UserGuard {
      static inject = [CurrentUser] as const;
      constructor(readonly user: CurrentUser) {}
      canActivate() {
        return true;
      }
    }
    await expect(
      AviFactory.create({ name: 'App', guards: [UserGuard], providers: [CurrentUser, Counter] }),
    ).rejects.toThrow(
      'App UserGuard depends on a request-scoped provider. Middleware and guards are created once',
    );
  });

  it('refuses app.get() for request-scoped providers', async () => {
    const instance = await AviFactory.create({ providers: [CurrentUser, Counter] });
    app = instance;
    expect(() => instance.get(CurrentUser)).toThrow(
      'CurrentUser is request-scoped and can only be resolved while handling a request',
    );
  });

  it('disposes after a failing handler and logs disposal errors without failing the response', async () => {
    const errors: string[] = [];
    const Broken = createToken<string>('Broken');
    const events: string[] = [];
    const controller = defineController({
      inject: [Broken],
      routes: (value) => [
        { method: 'GET', path: '/ok', handler: () => value },
        {
          method: 'GET',
          path: '/fail',
          handler: () => {
            throw new Error('boom');
          },
        },
      ],
    });
    const url = await serve(
      createAvi({
        logger: {
          error: (message) => {
            errors.push(message);
          },
        },
      }).register({
        controllers: [controller],
        providers: [
          {
            provide: Broken,
            useFactory: () => 'value',
            scope: 'request',
            dispose: (value: string) => {
              events.push(value);
              throw new Error('dispose failed');
            },
          },
        ],
      }),
    );

    const ok = await fetch(`${url}/ok`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('value');
    expect((await fetch(`${url}/fail`)).status).toBe(500);
    expect(events).toEqual(['value', 'value']);
    expect(errors).toContain('Failed to dispose request-scoped providers: GET /ok');
    expect(errors).toContain('Request failed: GET /fail');
  });

  it('describes request scope in manifests', async () => {
    const { describeApp } = await import('../src/index.js');
    const description = describeApp(DecoratedModule);
    expect(description.modules[0]?.providers[0]).toMatchObject({
      token: 'CurrentUser',
      scope: 'request',
      inject: ['REQUEST', 'Counter'],
    });
  });
});
