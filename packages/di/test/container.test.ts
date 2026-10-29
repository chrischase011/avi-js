import { describe, expect, it } from 'vitest';
import {
  Container,
  createToken,
  defineFactory,
  registerInjects,
  resolveInjects,
  type ModuleDefinition,
} from '../src/index.js';

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
    const Replica = createToken<string>('Replica');
    const c = await start(
      mod('App', {
        providers: [
          Db,
          Repo,
          { provide: Config, useValue: { url: 'db://local' } },
          { provide: Url, useFactory: (config: { url: string }) => config.url, inject: [Config] },
          defineFactory({
            provide: Replica,
            inject: [Config],
            useFactory: (c) => `${c.url}/replica`,
          }),
        ],
      }),
    );
    expect((c.get(Repo) as Repo).db).toBe(c.get(Db));
    expect(c.get(Url)).toBe('db://local');
    expect(c.get(Replica)).toBe('db://local/replica');
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

  it('accepts a list that leaves out optional constructor parameters', async () => {
    class Clock {
      readonly now = Date.now;
    }
    class Audit {
      static inject = [Clock] as const;
      constructor(
        readonly clock: Clock,
        readonly label?: string,
      ) {}
    }
    const c = await start(mod('App', { providers: [Clock, Audit] }));
    const audit = c.get(Audit) as Audit;
    expect(audit.clock).toBeInstanceOf(Clock);
    expect(audit.label).toBeUndefined();
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
      'NoInject has no dependency list for its 1 constructor argument',
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
          mod('App', { providers: [{ provide: Db, useClass: Db, scope: 'session' as never }] }),
        ]),
      'Invalid scope "session"',
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

describe('request scope', () => {
  const Request = createToken<{ id: number }>('Request');
  const UserId = createToken<string>('UserId');

  class Session {
    static inject = [Request, Db] as const;
    constructor(
      readonly request: { id: number },
      readonly db: Db,
    ) {}
  }

  class Handler {
    static inject = [Session] as const;
    constructor(readonly session: Session) {}
  }

  async function startScoped(...roots: ModuleDefinition[]) {
    const container = new Container(roots, { requestTokens: [Request] });
    await container.init();
    return container;
  }

  it('creates one instance per scope and shares singletons', async () => {
    const app = mod('App', {
      providers: [
        Db,
        { provide: Session, useClass: Session, scope: 'request' },
        { provide: Handler, useClass: Handler, scope: 'transient' },
      ],
    });
    const c = await startScoped(app);

    const first = c.requestScope(new Map([[Request, { id: 1 }]]));
    const a = first.resolve(app, Session) as Session;
    expect(first.resolve(app, Session)).toBe(a);
    expect((first.resolve(app, Handler) as Handler).session).toBe(a);
    expect(a.request).toEqual({ id: 1 });

    const second = c.requestScope(new Map([[Request, { id: 2 }]]));
    const b = second.resolve(app, Session) as Session;
    expect(b).not.toBe(a);
    expect(b.request).toEqual({ id: 2 });
    expect(b.db).toBe(a.db);
  });

  it('supports request-scoped factories returning plain values', async () => {
    const app = mod('App', {
      providers: [
        {
          provide: UserId,
          useFactory: (req: { id: number }) => `user-${String(req.id)}`,
          inject: [Request],
          scope: 'request',
        },
      ],
    });
    const c = await startScoped(app);
    expect(c.requestScope(new Map([[Request, { id: 7 }]])).resolve(app, UserId)).toBe('user-7');
  });

  it('reports which tokens need a request', async () => {
    const app = mod('App', {
      providers: [Db, { provide: Session, useClass: Session, scope: 'request' }],
    });
    const c = await startScoped(app);
    expect(c.needsRequest(app, [Db])).toBe(false);
    expect(c.needsRequest(app, [Db, Session])).toBe(true);
    expect(c.needsRequest(app, [Request])).toBe(true);
  });

  it('rejects a singleton that depends on request scope, through transients too', () => {
    expect(
      () =>
        new Container(
          [
            mod('App', {
              providers: [
                Db,
                { provide: Session, useClass: Session, scope: 'request' },
                { provide: Handler, useClass: Handler, scope: 'transient' },
                {
                  provide: Service,
                  useFactory: (handler: Handler) => handler,
                  inject: [Handler],
                },
              ],
            }),
          ],
          { requestTokens: [Request] },
        ),
    ).toThrow(
      'Singleton Service in App depends on request-scoped Handler (Service → Handler). A singleton outlives the request; make Service request-scoped or transient.',
    );
  });

  it('refuses request-scoped resolution outside a request', async () => {
    const app = mod('App', {
      providers: [Db, { provide: Session, useClass: Session, scope: 'request' }],
    });
    const c = await startScoped(app);
    expect(() => c.resolve(app, Session)).toThrow(
      'Session is request-scoped and can only be resolved while handling a request',
    );
    expect(() => c.get(Request)).toThrow(
      'Request is request-scoped and can only be resolved while handling a request',
    );
    expect(() => c.requestScope(new Map()).resolve(app, Session)).toThrow(
      'This request scope has no value for Request',
    );
  });

  it('requires request tokens to be declared', () => {
    expect(
      () =>
        new Container([
          mod('App', {
            providers: [Db, { provide: Session, useClass: Session, scope: 'request' }],
          }),
        ]),
    ).toThrow('Cannot resolve Session → Request in App');
  });

  it('disposes request instances in reverse order, keeping singletons', async () => {
    const events: string[] = [];
    const First = createToken<string>('First');
    const Second = createToken<string>('Second');
    const app = mod('App', {
      providers: [
        Db,
        {
          provide: First,
          useFactory: () => 'first',
          scope: 'request',
          dispose: (value: string) => events.push(value),
        },
        {
          provide: Second,
          useFactory: (first: string) => `${first}+second`,
          inject: [First],
          scope: 'request',
          dispose: (value: string) => events.push(value),
        },
      ],
    });
    const c = await startScoped(app);
    const scope = c.requestScope(new Map());
    scope.resolve(app, Second);
    await scope.dispose();
    await scope.dispose();
    expect(events).toEqual(['first+second', 'first']);
    expect(c.resolve(app, Db)).toBeInstanceOf(Db);
  });

  it('rejects async request-scoped factories', async () => {
    const app = mod('App', {
      providers: [{ provide: UserId, useFactory: () => Promise.resolve('x'), scope: 'request' }],
    });
    const c = await startScoped(app);
    expect(() => c.requestScope(new Map()).resolve(app, UserId)).toThrow(
      'Request-scoped provider UserId in App returned a Promise; only singletons may be async',
    );
  });

  it('describes request scope', () => {
    const c = new Container(
      [mod('App', { providers: [Db, { provide: Session, useClass: Session, scope: 'request' }] })],
      { requestTokens: [Request] },
    );
    expect(c.describe()[0]?.providers[1]).toEqual({
      token: 'Session',
      kind: 'class',
      scope: 'request',
      inject: ['Request', 'Db'],
    });
  });
});

describe('values', () => {
  it('supplies fixed values to every module, and never disposes them', async () => {
    const Root = createToken<{ name: string; [Symbol.dispose](): void }>('Root');
    let disposed = false;
    const root = {
      name: 'app',
      [Symbol.dispose]: () => {
        disposed = true;
      },
    };
    const Name = createToken<string>('Name');
    const inner = mod('Inner', {
      providers: [{ provide: Name, useFactory: (r: typeof root) => r.name, inject: [Root] }],
      exports: [Name],
    });
    const c = new Container([mod('App', { imports: [inner] })], {
      values: new Map([[Root, root]]),
    });
    await c.init();
    expect(c.get(Name)).toBe('app');
    await c.dispose();
    expect(disposed).toBe(false);
  });
});

describe('registerInjects', () => {
  it('gives classes without static inject their lists, and never replaces one', async () => {
    class Clock {
      readonly now = 0;
    }
    class Service {
      constructor(readonly clock: Clock) {}
    }
    class Explicit {
      static inject = [Clock] as const;
      constructor(readonly clock: Clock) {}
    }
    registerInjects([
      [Service, [Clock]],
      [Explicit, [Service]],
    ]);
    expect((Service as { inject?: unknown }).inject).toEqual([Clock]);
    expect(Explicit.inject).toEqual([Clock]);
    const c = await start(mod('App', { providers: [Clock, Service, Explicit] }));
    expect((c.get(Service) as Service).clock).toBe(c.get(Clock));
  });

  it('reads lists given as a function when the app starts, after every class exists', async () => {
    registerInjects(() => [[Later, [Clock]]]);
    // Declared after the call, as in an import cycle with inject.gen.ts.
    class Clock {
      readonly now = 0;
    }
    class Later {
      constructor(readonly clock: Clock) {}
    }
    const c = await start(mod('App', { providers: [Clock, Later] }));
    expect((c.get(Later) as Later).clock).toBe(c.get(Clock));
  });

  it('says which class is missing when the function runs too early', () => {
    registerInjects(() => [[Missing, []]]);
    expect(() => {
      resolveInjects();
    }).toThrow('inject.gen.ts lists a class that is not created yet');
    class Missing {
      readonly ok = true;
    }
    expect(new Missing().ok).toBe(true);
    // The list stayed queued: once the class exists, it applies.
    resolveInjects();
    expect((Missing as { inject?: unknown }).inject).toEqual([]);
  });

  it('names an entry broken by a circular import', () => {
    class Service {
      constructor(readonly clock: unknown) {}
    }
    expect(() => {
      registerInjects([[Service, [undefined as never]]]);
    }).toThrow('dependency 0 of Service is not a token (is there a circular import?)');
  });
});
