import { describe, expect, it } from 'vitest';
import { Container, createToken, type ModuleDefinition } from '../src/index.js';

const mod = (name: string, def: Omit<ModuleDefinition, 'name'> = {}): ModuleDefinition => ({
  name,
  ...def,
});

async function start(...roots: ModuleDefinition[]) {
  const container = new Container(roots);
  await container.init();
  return container;
}

class Db {
  query() {
    return 'rows';
  }
}

class Repo {
  static inject = [Db] as const;
  constructor(readonly db: Db) {}
}

class Service {
  static inject = [Repo] as const;
  constructor(readonly repo: Repo) {}
}

const Config = createToken<{ url: string }>('Config');

describe('providers', () => {
  it('resolves class, value and factory providers', async () => {
    const Url = createToken<string>('Url');
    const c = await start(
      mod('App', {
        providers: [
          Db,
          Repo,
          { provide: Config, useValue: { url: 'db://local' } },
          { provide: Url, useFactory: (config: { url: string }) => config.url, inject: [Config] },
        ],
      }),
    );
    expect((c.get(Repo) as Repo).db).toBe(c.get(Db));
    expect(c.get(Url)).toBe('db://local');
  });

  it('shares singletons and creates transients per injection', async () => {
    let made = 0;
    class Counter {
      readonly n = ++made;
    }
    class A {
      static inject = [Counter, Db] as const;
      constructor(
        readonly counter: Counter,
        readonly db: Db,
      ) {}
    }
    class B {
      static inject = [Counter, Db] as const;
      constructor(
        readonly counter: Counter,
        readonly db: Db,
      ) {}
    }
    const c = await start(
      mod('App', {
        providers: [Db, A, B, { provide: Counter, useClass: Counter, scope: 'transient' }],
      }),
    );
    const a = c.get(A) as A;
    const b = c.get(B) as B;
    expect(a.db).toBe(b.db);
    expect(a.counter).not.toBe(b.counter);
    expect(c.get(Counter)).not.toBe(c.get(Counter));
  });

  it('awaits async singleton factories during init', async () => {
    const Conn = createToken<{ open: boolean }>('Conn');
    const c = await start(
      mod('App', {
        providers: [
          {
            provide: Conn,
            useFactory: async () => {
              await new Promise((r) => setTimeout(r, 5));
              return { open: true };
            },
          },
        ],
      }),
    );
    expect(c.get(Conn)).toEqual({ open: true });
  });

  it('does not await a promise given as a value', async () => {
    const Pending = createToken<Promise<number>>('Pending');
    const promise = Promise.resolve(1);
    const c = await start(mod('App', { providers: [{ provide: Pending, useValue: promise }] }));
    expect(c.get(Pending)).toBe(promise);
  });

  it('rejects async transient factories', async () => {
    const T = createToken<number>('T');
    class User {
      static inject = [T] as const;
      constructor(readonly t: number) {}
    }
    const c = new Container([
      mod('App', {
        providers: [User, { provide: T, useFactory: () => Promise.resolve(1), scope: 'transient' }],
      }),
    ]);
    await expect(c.init()).rejects.toThrow(
      'Transient provider T in App returned a Promise; only singletons may be async',
    );
  });

  it('wraps creation errors with the provider and module', async () => {
    const boom = new Error('connection refused');
    const Conn = createToken('Conn');
    const c = new Container([
      mod('App', { providers: [{ provide: Conn, useFactory: () => Promise.reject(boom) }] }),
    ]);
    const error = await c.init().catch((e: unknown) => e);
    expect(error).toMatchObject({ message: 'Failed to create Conn in App', cause: boom });
  });
});

describe('validation', () => {
  it.each<[string, () => unknown, string]>([
    [
      'a missing static inject',
      () =>
        new Container([
          mod('App', {
            providers: [
              class NoInject {
                constructor(readonly db: Db) {}
              },
            ],
          }),
        ]),
      'NoInject takes 1 constructor arguments but static inject lists 0',
    ],
    [
      'an undefined token in inject',
      () =>
        new Container([
          mod('App', {
            providers: [
              class Bad {
                static inject = [undefined];
                constructor(readonly x: unknown) {}
              } as never,
            ],
          }),
        ]),
      'is there a circular import?',
    ],
    [
      'a factory with too few inject entries',
      () =>
        new Container([
          mod('App', {
            providers: [{ provide: Config, useFactory: (_a: unknown) => ({ url: '' }) }],
          }),
        ]),
      'takes 1 arguments but inject lists 0',
    ],
    [
      'an invalid provider',
      () => new Container([mod('App', { providers: [undefined as never] })]),
      'Invalid provider at App.providers[0]',
    ],
    [
      'two provider kinds at once',
      () =>
        new Container([mod('App', { providers: [{ provide: Db, useClass: Db, useValue: 1 }] })]),
      'exactly one of useClass, useValue or useFactory',
    ],
    [
      'an unknown scope',
      () =>
        new Container([
          mod('App', { providers: [{ provide: Db, useClass: Db, scope: 'request' as never }] }),
        ]),
      'Invalid scope "request"',
    ],
    [
      'a duplicate provider',
      () => new Container([mod('App', { providers: [Db, { provide: Db, useValue: {} }] })]),
      'Db is provided twice in App',
    ],
  ])('rejects %s', (_, build, message) => {
    expect(build).toThrow(message);
  });

  it('names the whole chain for a missing dependency', () => {
    const Lib = mod('LibModule', { providers: [] });
    expect(
      () => new Container([mod('UsersModule', { imports: [Lib], providers: [Service, Repo] })]),
    ).toThrow(
      'Cannot resolve Service → Repo → Db in UsersModule: Db is not provided by UsersModule or exported by its imports (LibModule)',
    );
  });

  it('detects dependency cycles', () => {
    class A {
      static inject: unknown[] = [];
      constructor(readonly b: unknown) {}
    }
    class B {
      static inject = [A];
      constructor(readonly a: unknown) {}
    }
    A.inject = [B];
    expect(() => new Container([mod('App', { providers: [A as never, B as never] })])).toThrow(
      'Dependency cycle: A → B → A',
    );
  });

  it('detects module import cycles', () => {
    const a: { name: string; imports: ModuleDefinition[] } = { name: 'A', imports: [] };
    const b = mod('B', { imports: [a] });
    a.imports.push(b);
    expect(() => new Container([a])).toThrow('Module import cycle: A → B → A');
  });

  it('checks consumers outside the graph, such as controllers', async () => {
    const app = mod('App', { providers: [Db] });
    const c = new Container([app]);
    expect(() => {
      c.check(app, [Db], 'UsersController');
    }).not.toThrow();
    expect(() => {
      c.check(app, [Repo], 'UsersController');
    }).toThrow('Cannot resolve UsersController → Repo in App');
    await c.init();
    expect(c.resolve(app, Db)).toBeInstanceOf(Db);
  });
});

describe('visibility', () => {
  it('hides providers a module does not export', () => {
    const Data = mod('DataModule', { providers: [Db] });
    expect(() => new Container([mod('App', { imports: [Data], providers: [Repo] })])).toThrow(
      'Cannot resolve Repo → Db in App: Db is not provided by App or exported by its imports (DataModule)',
    );
  });

  it('shares exported providers with importers', async () => {
    const Data = mod('DataModule', { providers: [Db], exports: [Db] });
    const app = mod('App', { imports: [Data], providers: [Repo] });
    const c = await start(app);
    expect((c.resolve(app, Repo) as Repo).db).toBe(c.resolve(Data, Db));
  });

  it('does not leak exports through more than one level', () => {
    const Data = mod('DataModule', { providers: [Db], exports: [Db] });
    const Mid = mod('MidModule', { imports: [Data] });
    expect(() => new Container([mod('App', { imports: [Mid], providers: [Repo] })])).toThrow(
      'Db is not provided by App',
    );
  });

  it('re-exports a token or a whole module', async () => {
    const Data = mod('DataModule', {
      providers: [Db, { provide: Config, useValue: { url: 'x' } }],
      exports: [Db, Config],
    });
    const byToken = mod('ByToken', { imports: [Data], exports: [Db] });
    const byModule = mod('ByModule', { imports: [Data], exports: [Data] });
    const app = mod('App', { imports: [byToken, byModule] });
    const c = await start(app);
    expect(c.resolve(app, Db)).toBe(c.resolve(Data, Db));
    expect(c.resolve(app, Config)).toEqual({ url: 'x' });
  });

  it('rejects exports a module cannot see', () => {
    expect(() => new Container([mod('App', { exports: [Db] })])).toThrow(
      'App exports Db, which it neither provides nor imports',
    );
    expect(() => new Container([mod('App', { exports: [mod('Other')] as never })])).toThrow(
      'expected a token or an imported module',
    );
  });

  it('prefers a module’s own provider over imported ones', async () => {
    const Data = mod('DataModule', {
      providers: [{ provide: Config, useValue: { url: 'shared' } }],
      exports: [Config],
    });
    const app = mod('App', {
      imports: [Data],
      providers: [{ provide: Config, useValue: { url: 'local' } }],
    });
    const c = await start(app);
    expect(c.resolve(app, Config)).toEqual({ url: 'local' });
  });

  it('rejects a token exported by two different imports', () => {
    const One = mod('One', {
      providers: [{ provide: Config, useValue: { url: '1' } }],
      exports: [Config],
    });
    const Two = mod('Two', {
      providers: [{ provide: Config, useValue: { url: '2' } }],
      exports: [Config],
    });
    const ConfigUser = createToken<string>('ConfigUser');
    expect(
      () =>
        new Container([
          mod('App', {
            imports: [One, Two],
            providers: [
              { provide: ConfigUser, useFactory: (c: { url: string }) => c.url, inject: [Config] },
            ],
          }),
        ]),
    ).toThrow('Config is exported by more than one import (One, Two)');
  });

  it('builds a module imported in several places once', async () => {
    const Data = mod('DataModule', { providers: [Db], exports: [Db] });
    const a = mod('A', { imports: [Data], exports: [Data] });
    const b = mod('B', { imports: [Data], exports: [Data] });
    const app = mod('App', { imports: [a, b] });
    const c = await start(app);
    expect(c.resolve(a, Db)).toBe(c.resolve(b, Db));
    expect(c.modules.map((m) => m.name)).toEqual(['DataModule', 'A', 'B', 'App']);
  });

  it('isolates containers built from the same definitions', async () => {
    const app = mod('App', { providers: [Db] });
    const one = await start(app);
    const two = await start(app);
    expect(one.get(Db)).not.toBe(two.get(Db));
  });
});

describe('get', () => {
  it('only sees what the root modules see', async () => {
    const Data = mod('DataModule', { providers: [Db] });
    const c = await start(mod('App', { imports: [Data] }));
    expect(() => c.get(Db)).toThrow('Db is not visible to the root modules');
  });

  it('requires init first', () => {
    const c = new Container([mod('App', { providers: [Db] })]);
    expect(() => c.get(Db)).toThrow('call init() first');
  });
});

describe('dispose', () => {
  it('disposes owned singletons in reverse creation order', async () => {
    const log: string[] = [];
    class First {
      [Symbol.dispose]() {
        log.push('First');
      }
    }
    class Second {
      static inject = [First] as const;
      constructor(readonly first: First) {}
      async [Symbol.asyncDispose]() {
        await Promise.resolve();
        log.push('Second');
      }
    }
    const Handle = createToken<{ id: string }>('Handle');
    const Shared = createToken<{ [Symbol.dispose](): void }>('Shared');
    const c = await start(
      mod('App', {
        providers: [
          Second,
          First,
          {
            provide: Handle,
            useFactory: (_s: Second) => ({ id: 'h' }),
            inject: [Second],
            dispose: (value: { id: string }) => {
              log.push(`Handle ${value.id}`);
            },
          },
          { provide: Shared, useValue: { [Symbol.dispose]: () => log.push('Shared') } },
        ],
      }),
    );
    await c.dispose();
    expect(log).toEqual(['Handle h', 'Second', 'First']);
  });

  it('keeps disposing after a failure and reports every error', async () => {
    const log: string[] = [];
    class Ok {
      [Symbol.dispose]() {
        log.push('Ok');
      }
    }
    class Bad {
      static inject = [Ok] as const;
      constructor(readonly ok: Ok) {}
      [Symbol.dispose]() {
        throw new Error('nope');
      }
    }
    const c = await start(mod('App', { providers: [Ok, Bad] }));
    await expect(c.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(log).toEqual(['Ok']);
  });

  it('disposes what was created when init fails', async () => {
    const log: string[] = [];
    class Opened {
      [Symbol.dispose]() {
        log.push('Opened');
      }
    }
    const Later = createToken('Later');
    const c = new Container([
      mod('App', {
        providers: [
          Opened,
          {
            provide: Later,
            useFactory: () => {
              throw new Error('fail');
            },
          },
        ],
      }),
    ]);
    await expect(c.init()).rejects.toThrow('Failed to create Later in App');
    expect(log).toEqual(['Opened']);
  });
});

describe('createToken', () => {
  it('creates distinct, frozen tokens', () => {
    const a = createToken('Same');
    const b = createToken('Same');
    expect(a).not.toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => createToken('')).toThrow('non-empty description');
  });
});

describe('overrides', () => {
  it('replaces a provider wherever it is declared', async () => {
    class FakeDb extends Db {
      override query() {
        return 'fake rows';
      }
    }
    const Data = mod('DataModule', { providers: [Db], exports: [Db] });
    const app = mod('App', { imports: [Data], providers: [Repo] });
    const c = new Container([app], { overrides: [{ provide: Db, useClass: FakeDb }] });
    await c.init();
    expect((c.resolve(app, Repo) as Repo).db.query()).toBe('fake rows');
  });

  it('rejects an override that matches nothing', () => {
    expect(
      () =>
        new Container([mod('App', { providers: [Db] })], {
          overrides: [{ provide: Config, useValue: { url: '' } }],
        }),
    ).toThrow('The override for Config matches no provider in the app');
  });

  it('rejects two overrides for one token', () => {
    expect(
      () =>
        new Container([mod('App', { providers: [Db] })], {
          overrides: [
            { provide: Db, useValue: {} },
            { provide: Db, useValue: {} },
          ],
        }),
    ).toThrow('Db is overridden twice');
  });
});
