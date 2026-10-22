import { afterEach, describe, expect, it } from 'vitest';
import {
  AviFactory,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  createAvi,
  defineController,
  defineModule,
  type AviApp,
  type Context,
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

const get = async (url: string) => {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
};

describe('metadata', () => {
  it('installs Symbol.metadata', () => {
    expect(typeof (Symbol as { metadata?: symbol }).metadata).toBe('symbol');
  });
});

describe('@Controller and route decorators', () => {
  it('binds handlers to the controller instance', async () => {
    @Controller('/count')
    class Counter {
      #count = 0;

      @Post()
      increment() {
        return ++this.#count;
      }

      @Get()
      read() {
        return this.#count;
      }
    }
    const url = await serve(createAvi().register({ controllers: [Counter] }));
    await fetch(`${url}/count`, { method: 'POST' });
    await fetch(`${url}/count`, { method: 'POST' });
    expect(await get(`${url}/count`)).toEqual({ status: 200, body: '2' });
  });

  it('supports private methods', async () => {
    @Controller()
    class Secret {
      @Get('/secret')
      // eslint-disable-next-line no-unused-private-class-members -- called through @Get
      #reveal() {
        return 'hidden';
      }
    }
    const url = await serve(createAvi().register({ controllers: [Secret] }));
    expect((await get(`${url}/secret`)).body).toBe('hidden');
  });

  it('inherits routes from base classes and dispatches to overrides', async () => {
    class Base {
      @Get('/health')
      health() {
        return 'base';
      }
    }
    @Controller('/svc')
    class Service extends Base {
      override health() {
        return 'overridden';
      }

      @Get('/name')
      name() {
        return 'svc';
      }
    }
    const url = await serve(createAvi().register({ controllers: [Service] }));
    expect((await get(`${url}/svc/health`)).body).toBe('overridden');
    expect((await get(`${url}/svc/name`)).body).toBe('svc');
  });

  it('keeps sibling subclasses separate', async () => {
    class Base {
      @Get('/a')
      a() {
        return 'a';
      }
    }
    @Controller('/one')
    class One extends Base {
      @Get('/one')
      one() {
        return 1;
      }
    }
    @Controller('/two')
    class Two extends Base {}
    const url = await serve(createAvi().register({ controllers: [One, Two] }));
    expect((await get(`${url}/one/one`)).status).toBe(200);
    expect((await get(`${url}/two/one`)).status).toBe(404);
    expect((await get(`${url}/two/a`)).body).toBe('a');
  });

  it('passes ctx to the method', async () => {
    @Controller('/items')
    class Items {
      @Get('/:id')
      one(ctx: Context) {
        return { id: ctx.params['id'], q: ctx.query.get('q') };
      }
    }
    const url = await serve(createAvi().register({ controllers: [Items] }));
    expect(JSON.parse((await get(`${url}/items/7?q=x`)).body)).toEqual({ id: '7', q: 'x' });
  });
});

describe('misuse', () => {
  it('requires parentheses', () => {
    expect(() => (Get as (...args: unknown[]) => unknown)(() => 1, { kind: 'method' })).toThrow(
      '@Get must be called: write @Get(), not @Get',
    );
    expect(() =>
      (Controller as (...args: unknown[]) => unknown)(() => undefined, { kind: 'class' }),
    ).toThrow('@Controller must be called');
  });

  it('explains legacy experimentalDecorators', () => {
    const decorate = Get('/x') as (...args: unknown[]) => unknown;
    expect(() => decorate({}, 'method', {})).toThrow(
      'Avi.js uses standard decorators. Turn off "experimentalDecorators"',
    );
  });

  it('rejects static methods', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- only the static route matters
      class Bad {
        @Get()
        static list() {
          return [];
        }
      }
      return Bad;
    }).toThrow('@Get cannot decorate static method list');
  });

  it('rejects invalid paths and prefixes', () => {
    expect(() => Get('x')).toThrow('@Get path must be empty or start with "/"');
    expect(() => Controller('users')).toThrow('Controller prefix must start with "/"');
  });

  it('rejects undecorated classes in controllers and register', () => {
    class Plain {
      @Get()
      list() {
        return [];
      }
    }
    expect(() => defineModule({ controllers: [Plain] })).toThrow(
      'Plain is not a controller: add @Controller()',
    );
    expect(() => createAvi().register(Plain)).toThrow('Plain is not a module: add @Module()');
  });

  it('checks static inject length at runtime too', () => {
    // @ts-expect-error the compile-time check catches this first
    @Controller()
    class NeedsDb {
      static inject = [] as const;
      constructor(readonly db: unknown) {}
    }
    expect(() => defineModule({ controllers: [NeedsDb as never] })).toThrow(
      'NeedsDb takes 1 constructor arguments but static inject lists 0',
    );
  });
});

describe('@Injectable', () => {
  it('sets the scope of a class listed by itself', async () => {
    let made = 0;
    @Injectable({ scope: 'transient' })
    class Stamp {
      readonly n = ++made;
    }
    const app = await AviFactory.create({ providers: [Stamp] });
    running.push(app);
    expect(app.get(Stamp)).not.toBe(app.get(Stamp));
  });

  it('is optional for singletons', async () => {
    class Plain {
      readonly kind = 'plain';
    }
    const app = await AviFactory.create({ providers: [Plain] });
    running.push(app);
    expect(app.get(Plain)).toBe(app.get(Plain));
  });

  it('rejects an unknown scope', () => {
    expect(() => Injectable({ scope: 'session' as never })).toThrow('Invalid scope "session"');
  });
});

describe('@Module', () => {
  it('names modules after the class in errors', async () => {
    class Missing {
      readonly kind = 'missing';
    }
    @Injectable()
    class NeedsMissing {
      static inject = [Missing] as const;
      constructor(readonly missing: Missing) {}
    }
    @Module({ providers: [NeedsMissing] })
    class BillingModule {}
    await expect(AviFactory.create(BillingModule)).rejects.toThrow(
      'Cannot resolve NeedsMissing → Missing in BillingModule',
    );
  });

  it('mixes freely with defineModule modules and controllers', async () => {
    class Greeter {
      greet() {
        return 'hi';
      }
    }
    const Shared = defineModule({ name: 'Shared', providers: [Greeter], exports: [Greeter] });

    @Module({ imports: [Shared], exports: [Shared] })
    class Middle {}

    const explicit = defineController({
      prefix: '/explicit',
      inject: [Greeter],
      routes: (g) => [{ method: 'GET', path: '/', handler: () => g.greet() }],
    });

    @Controller('/decorated')
    class Decorated {
      static inject = [Greeter] as const;
      constructor(private readonly g: Greeter) {}
      @Get()
      hello() {
        return this.g.greet();
      }
    }

    const Root = defineModule({ imports: [Middle], controllers: [explicit, Decorated] });
    const url = await serve(createAvi().register(Root));
    expect((await get(`${url}/explicit`)).body).toBe('hi');
    expect((await get(`${url}/decorated`)).body).toBe('hi');
  });
});

describe('AviFactory', () => {
  it('returns an initialized app', async () => {
    class Clock {
      readonly kind = 'clock';
    }
    @Module({ providers: [Clock] })
    class AppModule {}
    const app = await AviFactory.create(AppModule, { bodyLimit: 10 });
    running.push(app);
    expect(app.get(Clock)).toBeInstanceOf(Clock);
    expect(() => app.register({})).toThrow('after init()');
  });
});
