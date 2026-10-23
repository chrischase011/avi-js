import { createServer } from 'node:net';
import * as v from 'valibot';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Controller,
  Get,
  Injectable,
  Module,
  createAvi,
  createToken,
  defineConfig,
  defineController,
  defineModule,
  describeApp,
  type AviApp,
  type AviOptions,
} from '../src/index.js';

const running: AviApp[] = [];
let output: string[];
let lines: string[];
let tty: PropertyDescriptor | undefined;

beforeEach(() => {
  output = [];
  lines = [];
  tty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (tty) Object.defineProperty(process.stdout, 'isTTY', tty);
  else delete (process.stdout as { isTTY?: boolean }).isTTY;
  await Promise.all(running.splice(0).map((app) => app.close()));
});

function terminal(isTTY: boolean) {
  Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
}

const Config = defineConfig(
  v.object({ A: v.optional(v.string(), 'a'), B: v.optional(v.string(), 'b') }),
  {
    env: {},
  },
);

@Injectable()
class UsersService {}

@Controller('/users')
class UsersController {
  static inject = [UsersService] as const;
  constructor(readonly users: UsersService) {}
  @Get()
  list() {
    return [];
  }
  @Get('/:id')
  one() {
    return {};
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
class UsersModule {}

@Module({ imports: [Config.module, UsersModule] })
class AppModule {}

const explicitApp = defineModule({
  name: 'AppModule',
  imports: [
    Config.module,
    defineModule({
      name: 'UsersModule',
      providers: [UsersService],
      controllers: [
        defineController({
          name: 'UsersController',
          prefix: '/users',
          inject: [UsersService],
          routes: () => [
            { method: 'GET', path: '/', handler: () => [] },
            { method: 'GET', path: '/:id', handler: () => ({}) },
          ],
        }),
      ],
    }),
  ],
});

async function start(root: Parameters<AviApp['register']>[0], options: AviOptions = {}) {
  const app = createAvi({ logger: { error: () => undefined }, ...options }).register(root);
  running.push(app);
  await app.listen(0, '127.0.0.1');
  return app;
}

describe('startup summary', () => {
  it('stays quiet by default under NODE_ENV=test', async () => {
    expect(process.env['NODE_ENV']).toBe('test');
    await start(AppModule);
    expect(output).toEqual([]);
    expect(lines).toEqual([]);
  });

  it.each([
    ['decorators', AppModule],
    ['explicit', explicitApp],
  ] as const)('reports what startup checked (%s), matching describeApp', async (_style, root) => {
    terminal(false);
    await start(root, { startupSummary: true });

    const description = describeApp(root);
    const providers = description.modules.reduce((sum, m) => sum + m.providers.length, 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      new RegExp(
        `^Avi\\.js \\d+\\.\\d+\\.\\d+ started in [\\d.]+ ms: ${String(description.modules.length)} modules, ${String(providers)} providers, 2 routes, config validated \\(2 variables\\), listening on http://127\\.0\\.0\\.1:\\d+$`,
      ),
    );
  });

  it('prints a block in a terminal, listing routes on request', async () => {
    terminal(true);
    await start(AppModule, { startupSummary: 'routes' });

    const block = output.join('');
    for (const line of [
      'Application bootstrap',
      '✓ 3 modules loaded',
      '✓ Dependency graph validated',
      '✓ 2 providers resolved',
      '✓ Config validated (2 variables)',
      '✓ 2 routes registered',
      'HTTP server ready on http://127.0.0.1:',
      'Startup completed in',
    ]) {
      expect(block).toContain(line);
    }
    expect(block).toMatch(/GET\s+\/users\/:id\s+UsersController/);
  });

  it('shows how far startup got and the failing step', async () => {
    terminal(true);
    const Database = createToken<string>('Database');
    class Repo {
      static inject = [Database] as const;
      constructor(readonly db: string) {}
    }
    await expect(
      start({ name: 'App', providers: [Repo] }, { startupSummary: true }),
    ).rejects.toThrow('Cannot resolve Repo → Database');
    const missing = output.join('');
    // The graph is checked while the container is built, before any module counts as loaded.
    expect(missing).not.toContain('loaded');
    expect(missing).toContain('✗ Dependency graph: Cannot resolve Repo → Database');
    expect(missing).toContain('Startup failed after');
    expect(missing).not.toContain('Dependency graph validated');

    output.length = 0;
    const Broken = createToken<string>('Broken');
    const failing = {
      provide: Broken,
      useFactory: () => Promise.reject(new Error('cannot connect')),
    };
    await expect(
      start({ name: 'App', providers: [failing] }, { startupSummary: true }),
    ).rejects.toThrow('Failed to create Broken');
    expect(output.join('')).toContain('✓ Dependency graph validated');
    expect(output.join('')).toContain(
      '✗ Providers: Failed to create Broken in App\n  cannot connect',
    );
  });

  it('names the HTTP server when the port is taken', async () => {
    terminal(true);
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const { port } = blocker.address() as { port: number };
    const app = createAvi({ startupSummary: true }).register({ name: 'App' });
    running.push(app);
    try {
      await expect(app.listen(port, '127.0.0.1')).rejects.toThrow();
      expect(output.join('')).toContain('✗ HTTP server:');
      expect(output.join('')).toContain('✓ 0 routes registered');
    } finally {
      blocker.close();
    }
  });

  it('gives a structured entry to a logger with info', async () => {
    terminal(true);
    const logger = { error: vi.fn(), info: vi.fn() };
    await start(AppModule, { logger, startupSummary: true });
    expect(output).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(
      'Application started',
      expect.objectContaining({
        modules: 3,
        providers: 2,
        routes: 2,
        configVariables: 2,
        url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) as unknown,
      }),
    );
    const fields = logger.info.mock.calls[0]?.[1] as { durationMs: number };
    expect(fields.durationMs).toBeGreaterThan(0);
  });

  it('can be turned off, and init() alone prints nothing', async () => {
    terminal(true);
    await start(AppModule, { startupSummary: false });
    const app = createAvi({ startupSummary: true }).register(AppModule);
    running.push(app);
    await app.init();
    expect(output).toEqual([]);
  });
});
