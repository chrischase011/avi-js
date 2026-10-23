import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Controller,
  Get,
  HttpError,
  UseGuards,
  UseMiddleware,
  createAvi,
  createToken,
  defineController,
  defineModule,
  reply,
  type AviApp,
  type AviOptions,
  type Context,
  type Guard,
  type Middleware,
  type Next,
  type ResponseInfo,
} from '../src/index.js';

const running: AviApp[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()));
});

async function serve(app: AviApp): Promise<string> {
  running.push(app);
  const { port } = await app.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${String(port)}`;
}

const trace =
  (log: string[], name: string): Middleware =>
  async (_ctx, next) => {
    log.push(`${name}:in`);
    const result = await next();
    log.push(`${name}:out`);
    return result;
  };

const allow =
  (log: string[], name: string): Guard =>
  () => {
    log.push(`guard:${name}`);
    return true;
  };

describe('pipeline order', () => {
  it('runs app, module, controller and route stages in order (explicit API)', async () => {
    const log: string[] = [];
    const items = defineController({
      prefix: '/items',
      middleware: [trace(log, 'controller')],
      guards: [allow(log, 'controller')],
      routes: [
        {
          method: 'GET',
          path: '/',
          middleware: [trace(log, 'route')],
          guards: [allow(log, 'route')],
          handler: () => {
            log.push('handler');
            return 'ok';
          },
        },
      ],
    });
    const app = createAvi({
      middleware: [trace(log, 'app')],
      guards: [allow(log, 'app')],
    }).register({
      middleware: [trace(log, 'module')],
      guards: [allow(log, 'module')],
      controllers: [items],
    });
    const url = await serve(app);

    expect(await (await fetch(`${url}/items`)).text()).toBe('ok');
    expect(log).toEqual([
      'app:in',
      'module:in',
      'controller:in',
      'route:in',
      'guard:app',
      'guard:module',
      'guard:controller',
      'guard:route',
      'handler',
      'route:out',
      'controller:out',
      'module:out',
      'app:out',
    ]);
  });

  it('runs the same order with decorators', async () => {
    const log: string[] = [];

    @Controller('/items')
    @UseMiddleware(trace(log, 'controller'))
    @UseGuards(allow(log, 'controller'))
    class Items {
      @Get()
      @UseMiddleware(trace(log, 'route'))
      @UseGuards(allow(log, 'route'))
      list() {
        log.push('handler');
        return 'ok';
      }
    }

    const app = createAvi({
      middleware: [trace(log, 'app')],
      guards: [allow(log, 'app')],
    }).register({
      middleware: [trace(log, 'module')],
      guards: [allow(log, 'module')],
      controllers: [Items],
    });
    const url = await serve(app);

    expect(await (await fetch(`${url}/items`)).text()).toBe('ok');
    expect(log).toEqual([
      'app:in',
      'module:in',
      'controller:in',
      'route:in',
      'guard:app',
      'guard:module',
      'guard:controller',
      'guard:route',
      'handler',
      'route:out',
      'controller:out',
      'module:out',
      'app:out',
    ]);
  });

  it('accepts @UseMiddleware above or below @Controller', async () => {
    const log: string[] = [];

    @UseMiddleware(trace(log, 'above'))
    @Controller()
    @UseMiddleware(trace(log, 'below'))
    class Both {
      @Get('/x')
      x() {
        return 'x';
      }
    }

    const url = await serve(createAvi().register({ controllers: [Both] }));
    await (await fetch(`${url}/x`)).text();
    expect(log).toEqual(['below:in', 'above:in', 'above:out', 'below:out']);
  });

  it('applies module middleware only to that module’s own controllers', async () => {
    const log: string[] = [];
    const inner = defineController({
      prefix: '/inner',
      routes: [{ method: 'GET', path: '/', handler: () => 'inner' }],
    });
    const Inner = defineModule({ name: 'Inner', controllers: [inner] });
    const outer = defineController({
      prefix: '/outer',
      routes: [{ method: 'GET', path: '/', handler: () => 'outer' }],
    });
    const app = createAvi().register({
      imports: [Inner],
      middleware: [trace(log, 'outer-module')],
      controllers: [outer],
    });
    const url = await serve(app);

    await (await fetch(`${url}/inner`)).text();
    expect(log).toEqual([]);
    await (await fetch(`${url}/outer`)).text();
    expect(log).toEqual(['outer-module:in', 'outer-module:out']);
  });

  it('leaves routes without middleware or guards untouched', async () => {
    const handler = () => 'plain';
    const app = createAvi().register({
      controllers: [defineController({ routes: [{ method: 'GET', path: '/', handler }] })],
    });
    const url = await serve(app);
    expect(await (await fetch(url)).text()).toBe('plain');
  });
});

describe('middleware behavior', () => {
  it('can wrap the result and set headers', async () => {
    const envelope: Middleware = async (ctx, next) => {
      ctx.setHeader('x-request-id', 'r1');
      return { data: await next() };
    };
    const app = createAvi({ middleware: [envelope] }).register({
      controllers: [
        defineController({ routes: [{ method: 'GET', path: '/', handler: () => [1] }] }),
      ],
    });
    const res = await fetch(await serve(app));
    expect(res.headers.get('x-request-id')).toBe('r1');
    expect(await res.json()).toEqual({ data: [1] });
  });

  it('can short-circuit before guards and the handler', async () => {
    const handler = vi.fn(() => 'fresh');
    const guard = vi.fn(() => true);
    const cache: Middleware = () => reply('cached', { headers: { 'x-cache': 'hit' } });
    const app = createAvi({ middleware: [cache], guards: [guard] }).register({
      controllers: [defineController({ routes: [{ method: 'GET', path: '/', handler }] })],
    });
    const res = await fetch(await serve(app));
    expect(await res.text()).toBe('cached');
    expect(res.headers.get('x-cache')).toBe('hit');
    expect(handler).not.toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
  });

  it('turns calling next twice into a logged 500', async () => {
    const logger = { error: vi.fn() };
    const twice: Middleware = async (_ctx, next) => {
      await next();
      return next();
    };
    const app = createAvi({ logger, middleware: [twice] }).register({
      controllers: [defineController({ routes: [{ method: 'GET', path: '/', handler: () => 1 }] })],
    });
    const res = await fetch(await serve(app));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('next()');
    expect(logger.error).toHaveBeenCalledWith(
      'Request failed: GET /',
      expect.objectContaining({ message: 'next() was called more than once' }),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each<[string, AviOptions]>([
    [
      'middleware',
      {
        middleware: [
          () => {
            throw new Error('mw');
          },
        ],
      },
    ],
    ['async middleware', { middleware: [() => Promise.reject(new Error('mw'))] }],
    [
      'a guard',
      {
        guards: [
          () => {
            throw new Error('guard');
          },
        ],
      },
    ],
    ['an async guard', { guards: [() => Promise.reject(new Error('guard'))] }],
  ])('sends a safe 500 when %s throws', async (_, options) => {
    const logger = { error: vi.fn() };
    const app = createAvi({ ...options, logger }).register({
      controllers: [defineController({ routes: [{ method: 'GET', path: '/', handler: () => 1 }] })],
    });
    const res = await fetch(await serve(app));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error' });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe('guards', () => {
  const secret = defineController({
    routes: [{ method: 'GET', path: '/secret', handler: () => 'secret' }],
  });

  it('answers 403 when a guard says no', async () => {
    const url = await serve(
      createAvi({ guards: [() => false] }).register({ controllers: [secret] }),
    );
    const res = await fetch(`${url}/secret`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Forbidden' });
  });

  it('lets a guard answer 401 by throwing', async () => {
    const auth: Guard = (ctx) => {
      if (!ctx.headers.authorization) {
        throw new HttpError(401, 'Sign in first', { headers: { 'www-authenticate': 'Bearer' } });
      }
      return true;
    };
    const url = await serve(createAvi({ guards: [auth] }).register({ controllers: [secret] }));

    const anonymous = await fetch(`${url}/secret`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toBe('Bearer');

    const signedIn = await fetch(`${url}/secret`, { headers: { authorization: 'Bearer x' } });
    expect(await signedIn.text()).toBe('secret');
  });
});

describe('classes with dependencies', () => {
  interface Session {
    user: string;
  }
  const Sessions = createToken<Map<string, Session>>('Sessions');

  class AuthMiddleware {
    static inject = [Sessions] as const;
    constructor(private readonly sessions: Map<string, Session>) {}

    use(ctx: Context, next: Next) {
      const token = ctx.headers.authorization ?? '';
      const session = this.sessions.get(token);
      if (session) ctx.state['username'] = session.user;
      return next();
    }
  }

  class SignedInGuard {
    canActivate(ctx: Context) {
      return ctx.state['username'] !== undefined;
    }
  }

  it('builds middleware and guards with their dependencies from the module', async () => {
    @Controller('/me')
    @UseMiddleware(AuthMiddleware)
    @UseGuards(SignedInGuard)
    class Me {
      @Get()
      me(ctx: Context) {
        return { user: ctx.state['username'] };
      }
    }

    const sessions = new Map([['t1', { user: 'ada' }]]);
    const url = await serve(
      createAvi().register({
        providers: [{ provide: Sessions, useValue: sessions }],
        controllers: [Me],
      }),
    );

    expect(await (await fetch(`${url}/me`, { headers: { authorization: 't1' } })).json()).toEqual({
      user: 'ada',
    });
    expect((await fetch(`${url}/me`)).status).toBe(403);
  });

  it('builds each class once per module', async () => {
    let built = 0;
    class Counted {
      constructor() {
        built++;
      }
      use(_ctx: Context, next: Next) {
        return next();
      }
    }
    const a = defineController({
      prefix: '/a',
      middleware: [Counted],
      routes: [{ method: 'GET', path: '/', handler: () => 'a' }],
    });
    const b = defineController({
      prefix: '/b',
      middleware: [Counted],
      routes: [
        { method: 'GET', path: '/', handler: () => 'b' },
        { method: 'GET', path: '/2', middleware: [Counted], handler: () => 'b2' },
      ],
    });
    await serve(createAvi().register({ controllers: [a, b] }));
    expect(built).toBe(1);
  });

  it('fails init when a dependency is not visible', async () => {
    const guarded = defineController({
      prefix: '/x',
      middleware: [AuthMiddleware],
      routes: [{ method: 'GET', path: '/', handler: () => 'x' }],
    });
    await expect(
      createAvi()
        .register({ name: 'AppModule', controllers: [guarded] })
        .init(),
    ).rejects.toThrow(
      'Cannot resolve AppModule controller /x AuthMiddleware → Sessions in AppModule',
    );
  });

  it('rejects classes without the right method', () => {
    class NotMiddleware {
      run() {
        return 1;
      }
    }
    expect(() => defineController({ middleware: [NotMiddleware as never], routes: [] })).toThrow(
      'NotMiddleware in Controller / middleware needs a use() method',
    );
    expect(() => UseGuards(NotMiddleware as never)).toThrow('needs a canActivate() method');
  });
});

describe('errorHandler and onResponse', () => {
  it('formats errors from any stage and reports every response', async () => {
    const infos: ResponseInfo[] = [];
    let finished!: () => void;
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const app = createAvi({
      guards: [(ctx) => ctx.path !== '/blocked'],
      errorHandler: (error) =>
        reply(
          { title: error instanceof HttpError ? error.message : 'Unexpected error' },
          { headers: { 'content-type': 'application/problem+json' } },
        ),
      onResponse: (info) => {
        infos.push(info);
        if (infos.length === 2) finished();
      },
    }).register({
      controllers: [
        defineController({
          routes: [
            { method: 'GET', path: '/blocked', handler: () => 'never' },
            { method: 'GET', path: '/items/:id', handler: () => 'ok' },
          ],
        }),
      ],
    });
    const url = await serve(app);

    const blocked = await fetch(`${url}/blocked`);
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get('content-type')).toBe('application/problem+json');
    expect(await blocked.json()).toEqual({ title: 'Forbidden' });

    await (await fetch(`${url}/items/3`)).text();
    await done;
    expect(infos.map((i) => [i.route, i.status])).toEqual([
      ['/blocked', 403],
      ['/items/:id', 200],
    ]);
  });
});

describe('isolation', () => {
  it('never mixes state or headers between concurrent requests', async () => {
    const tag: Middleware = async (ctx, next) => {
      const id = ctx.query.get('id') ?? '';
      ctx.state['id'] = id;
      ctx.setHeader('x-id', id);
      await new Promise((r) => setTimeout(r, Number(id) % 5));
      return next();
    };
    const echo = defineController({
      routes: [
        {
          method: 'GET',
          path: '/echo',
          handler: async (ctx) => {
            await new Promise((r) => setTimeout(r, Number(ctx.query.get('id')) % 3));
            return { id: ctx.state['id'] };
          },
        },
      ],
    });
    const url = await serve(createAvi({ middleware: [tag] }).register({ controllers: [echo] }));

    const results = await Promise.all(
      // Stay under the ~200 connection backlog Windows allows.
      Array.from({ length: 150 }, async (_, i) => {
        const res = await fetch(`${url}/echo?id=${String(i)}`);
        return {
          expected: String(i),
          header: res.headers.get('x-id'),
          body: ((await res.json()) as { id: string }).id,
        };
      }),
    );
    for (const { expected, header, body } of results) {
      expect(header).toBe(expected);
      expect(body).toBe(expected);
    }
  });
});
