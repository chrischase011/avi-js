import { afterEach, describe, expect, it } from 'vitest';
import {
  Controller,
  Get,
  createAvi,
  createToken,
  defineController,
  defineModule,
  describeApp,
  type AppDescription,
  type AviApp,
  type AviModule,
} from '../src/index.js';

const running: AviApp[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()));
});

function buildApp(extraRoute = false): AviModule {
  const Greeting = createToken<string>('Greeting');

  @Controller('/hello')
  class Hello {
    static inject = [Greeting] as const;
    constructor(private readonly greeting: string) {}

    @Get('/:name')
    say() {
      return this.greeting;
    }
  }

  const items = defineController({
    name: 'Items',
    prefix: '/items',
    routes: [
      { method: 'GET', path: '/', handler: () => [1, 2] },
      ...(extraRoute ? [{ method: 'DELETE' as const, path: '/', handler: () => undefined }] : []),
    ],
  });

  return defineModule({
    name: 'AppModule',
    providers: [{ provide: Greeting, useValue: 'hi' }],
    controllers: [Hello, items],
  });
}

async function responses(app: AviApp): Promise<string[]> {
  running.push(app);
  const { port } = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${String(port)}`;
  const out: string[] = [];
  for (const [path, method] of [
    ['/hello/ada', 'GET'],
    ['/items', 'GET'],
    ['/items', 'PUT'],
    ['/nope', 'GET'],
  ] as const) {
    const res = await fetch(`${base}${path}`, { method });
    out.push(`${String(res.status)} ${res.headers.get('allow') ?? ''} ${await res.text()}`);
  }
  return out;
}

describe('manifest mode', () => {
  it('behaves exactly like runtime mode', async () => {
    const module = buildApp();
    const manifest = describeApp(module);
    const runtime = await responses(createAvi().register(module));
    const compiled = await responses(createAvi({ manifest }).register(module));
    expect(compiled).toEqual(runtime);
  });

  it('accepts a manifest that went through JSON', async () => {
    const module = buildApp();
    const manifest = JSON.parse(JSON.stringify(describeApp(module))) as AppDescription;
    const app = createAvi({ manifest }).register(module);
    running.push(app);
    await expect(app.init()).resolves.toBeUndefined();
  });

  it('refuses to start when the app changed since the manifest was made', async () => {
    const manifest = describeApp(buildApp());
    const app = createAvi({ manifest }).register(buildApp(true));
    await expect(app.init()).rejects.toThrow(
      'The app does not match its manifest (first difference at $.modules[0].controllers[1].routes[1])',
    );
  });

  it('describes without creating providers', () => {
    let created = 0;
    const Db = createToken('Db');
    const module = defineModule({
      providers: [
        {
          provide: Db,
          useFactory: () => {
            created++;
            return {};
          },
        },
      ],
    });
    describeApp(module);
    expect(created).toBe(0);
  });

  it('reports graph errors like init() does', () => {
    const Missing = createToken('Missing');
    const needs = defineController({ inject: [Missing], routes: () => [] });
    expect(() => describeApp(defineModule({ name: 'Broken', controllers: [needs] }))).toThrow(
      'Cannot resolve Broken controller / → Missing in Broken',
    );
    expect(() =>
      describeApp(
        defineModule({
          name: 'Broken',
          providers: [
            { provide: createToken('X'), useFactory: (_m: unknown) => 1, inject: [Missing] },
          ],
        }),
      ),
    ).toThrow('Cannot resolve X → Missing in Broken');
  });
});
