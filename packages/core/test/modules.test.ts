import { afterEach, describe, expect, it } from 'vitest';
import {
  createAvi,
  createToken,
  defineController,
  defineModule,
  type AviApp,
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

interface GreeterConfig {
  greeting: string;
}
const GreeterConfig = createToken<GreeterConfig>('GreeterConfig');

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

const greetings = defineController({
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

describe('modules and DI over HTTP', () => {
  it('injects exported services into controllers', async () => {
    const url = await serve(
      createAvi().register({ imports: [GreetingModule], controllers: [greetings] }),
    );
    expect(await (await fetch(`${url}/greet/Ada`)).json()).toEqual({ message: 'Hello, Ada!' });
  });

  it('serves controllers declared inside imported modules, with their own prefix', async () => {
    const Users = defineModule({
      name: 'UsersModule',
      prefix: '/api',
      imports: [GreetingModule],
      controllers: [greetings],
    });
    const url = await serve(createAvi().register({ imports: [Users] }));
    expect((await fetch(`${url}/api/greet/Ada`)).status).toBe(200);
    expect((await fetch(`${url}/greet/Ada`)).status).toBe(404);
  });

  it('fails init with the chain when a controller cannot see a provider', async () => {
    const Hidden = defineModule({
      name: 'HiddenModule',
      providers: [GreetingService, { provide: GreeterConfig, useValue: { greeting: 'Hi' } }],
    });
    const instance = createAvi().register({
      name: 'AppModule',
      imports: [Hidden],
      controllers: [greetings],
    });
    await expect(instance.init()).rejects.toThrow(
      'Cannot resolve AppModule controller /greet → GreetingService in AppModule: GreetingService is not provided by AppModule or exported by its imports (HiddenModule)',
    );
  });

  it('keeps root modules separate', async () => {
    const instance = createAvi()
      .register({ name: 'Greetings', imports: [GreetingModule] })
      .register({ name: 'Api', controllers: [greetings] });
    await expect(instance.init()).rejects.toThrow('GreetingService is not provided by Api');
  });

  it('resolves root-visible providers with get()', async () => {
    const instance = createAvi().register({ imports: [GreetingModule] });
    expect(() => instance.get(GreetingService)).toThrow('before app.get()');
    await instance.init();
    app = instance;

    const service = instance.get(GreetingService);
    expect(service.greet('Grace')).toBe('Hello, Grace!');
    expect(instance.get(GreetingService)).toBe(service);
    expect(() => instance.get(GreeterConfig)).toThrow('not visible to the root modules');
  });

  it('gives each app its own singletons', async () => {
    const one = createAvi().register({ imports: [GreetingModule] });
    const two = createAvi().register({ imports: [GreetingModule] });
    await Promise.all([one.init(), two.init()]);
    expect(one.get(GreetingService)).not.toBe(two.get(GreetingService));
    await Promise.all([one.close(), two.close()]);
  });

  it('disposes providers after the server stops', async () => {
    const events: string[] = [];
    class Db {
      async [Symbol.asyncDispose]() {
        await Promise.resolve();
        events.push('db disposed');
      }
    }
    const db = defineController({
      inject: [Db],
      routes: [{ method: 'GET', path: '/db', handler: () => 'ok' }],
    });
    const instance = createAvi().register({ providers: [Db], controllers: [db] });
    const { port } = await instance.listen(0, '127.0.0.1');
    expect(await (await fetch(`http://127.0.0.1:${String(port)}/db`)).text()).toBe('ok');

    await instance.close();
    events.push('closed');
    expect(events).toEqual(['db disposed', 'closed']);
  });

  it('disposes created providers when route registration fails', async () => {
    const events: string[] = [];
    class Db {
      [Symbol.dispose]() {
        events.push('db disposed');
      }
    }
    const one = defineController({
      inject: [Db],
      routes: () => [{ method: 'GET', path: '/x', handler: () => 1 }],
    });
    const two = defineController({ routes: [{ method: 'GET', path: '/x', handler: () => 2 }] });
    const instance = createAvi().register({ providers: [Db], controllers: [one, two] });
    await expect(instance.init()).rejects.toThrow('Duplicate route');
    expect(events).toEqual(['db disposed']);
  });

  it('awaits async factories before serving', async () => {
    const Clock = createToken<{ now: () => string }>('Clock');
    const clockController = defineController({
      inject: [Clock],
      routes: (clock) => [{ method: 'GET', path: '/now', handler: () => clock.now() }],
    });
    const url = await serve(
      createAvi().register({
        providers: [
          {
            provide: Clock,
            useFactory: async () => {
              await new Promise((r) => setTimeout(r, 5));
              return { now: () => 'noon' };
            },
          },
        ],
        controllers: [clockController],
      }),
    );
    expect(await (await fetch(`${url}/now`)).text()).toBe('noon');
  });
});

describe('defineModule', () => {
  it('rejects imports that are not modules', () => {
    expect(() => defineModule({ name: 'App', imports: [undefined as never] })).toThrow(
      'App.imports[0] is not a module created with defineModule (is there a circular import?)',
    );
    expect(() => defineModule({ imports: [{ providers: [] } as never] })).toThrow(
      'not a module created with defineModule',
    );
  });

  it('names anonymous modules', () => {
    expect(defineModule().name).toMatch(/^AnonymousModule\d+$/);
  });

  it('works as a configurable module factory', async () => {
    const ConfigModule = {
      forRoot: (greeting: string) =>
        defineModule({
          name: 'ConfigModule',
          providers: [{ provide: GreeterConfig, useValue: { greeting } }],
          exports: [GreeterConfig],
        }),
    };
    const instance = createAvi().register({
      imports: [ConfigModule.forRoot('Hi')],
      providers: [GreetingService],
    });
    await instance.init();
    app = instance;
    expect(instance.get(GreetingService).greet('Linus')).toBe('Hi, Linus!');
  });
});
