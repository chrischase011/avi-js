import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as v from 'valibot';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AviFactory,
  ConfigError,
  Injectable,
  Module,
  createAvi,
  defineConfig,
  type AviApp,
} from '../src/index.js';

const schema = v.object({
  PORT: v.optional(v.pipe(v.string(), v.regex(/^\d+$/), v.transform(Number)), '3000'),
  DATABASE_URL: v.pipe(v.string(), v.url()),
  LOG_LEVEL: v.optional(v.picklist(['info', 'warn']), 'info'),
});

let dir: string;
let app: AviApp | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'avi-config-'));
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe('defineConfig', () => {
  it('validates and converts the environment', async () => {
    const Config = defineConfig(schema, {
      env: { DATABASE_URL: 'postgres://db/app', PORT: '8080' },
    });
    expect(await Config.load()).toEqual({
      PORT: 8080,
      DATABASE_URL: 'postgres://db/app',
      LOG_LEVEL: 'info',
    });
  });

  it('lists every problem and never includes the values', async () => {
    const Config = defineConfig(schema, {
      env: { DATABASE_URL: 'secret-password-not-a-url', PORT: 'eighty', LOG_LEVEL: 'loud' },
    });
    const error = await Config.load().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ConfigError);
    const { message, issues } = error as ConfigError;
    expect(issues.map((issue) => issue.key).sort()).toEqual(['DATABASE_URL', 'LOG_LEVEL', 'PORT']);
    expect(message).toMatch(/^Invalid configuration: /);
    for (const value of ['secret-password-not-a-url', 'eighty', 'loud']) {
      expect(message).not.toContain(value);
    }
  });

  it('keeps values out of errors even after a transform, or when the schema throws', async () => {
    const secret = 'sk_live_SuperSecret';
    const schemas = {
      changed: v.object({ KEY: v.pipe(v.string(), v.toLowerCase(), v.regex(/^pk_/)) }),
      trimmed: v.object({ KEY: v.pipe(v.string(), v.trim(), v.regex(/^pk_/)) }),
      parsed: v.object({ KEY: v.pipe(v.string(), v.transform(JSON.parse)) }),
      whole: v.pipe(
        v.object({ KEY: v.string() }),
        v.check(
          (env) => env.KEY.startsWith('pk_'),
          (issue) => `bad ${JSON.stringify(issue.input)}`,
        ),
      ),
    };
    for (const [name, schema] of Object.entries(schemas)) {
      const Config = defineConfig(schema as v.GenericSchema, { env: { KEY: ` ${secret} ` } });
      const error: unknown = await Config.load().catch((e: unknown) => e);
      expect(error, name).toBeInstanceOf(ConfigError);
      // Nothing reachable from the error may hold the value, including its causes.
      const text = JSON.stringify(error, Object.getOwnPropertyNames(error)) + String(error);
      expect(text.toLowerCase(), name).not.toContain('supersecret');
      expect((error as Error).cause, name).toBeUndefined();
    }
  });

  it('does not redact digits out of messages for short values', async () => {
    const Config = defineConfig(
      v.object({ PORT: v.pipe(v.string(), v.transform(Number), v.minValue(1024)) }),
      { env: { PORT: '1' } },
    );
    await expect(Config.load()).rejects.toThrow(/>=1024/);
  });

  it('reports missing variables by name', async () => {
    const Config = defineConfig(schema, { env: {} });
    await expect(Config.load()).rejects.toThrow(/DATABASE_URL: /);
  });

  it('reads an env file, with real variables winning', async () => {
    const file = path.join(dir, '.env');
    await writeFile(file, 'DATABASE_URL=postgres://file/app\nPORT=5000\n# comment\n');
    const Config = defineConfig(schema, { envFile: file, env: { PORT: '6000' } });
    expect(await Config.load()).toMatchObject({ DATABASE_URL: 'postgres://file/app', PORT: 6000 });
  });

  it('skips a missing env file unless it is required', async () => {
    const missing = path.join(dir, 'nope.env');
    const env = { DATABASE_URL: 'postgres://db/app' };
    await expect(defineConfig(schema, { envFile: missing, env }).load()).resolves.toBeDefined();
    await expect(
      defineConfig(schema, { envFile: { path: missing, required: true }, env }).load(),
    ).rejects.toThrow(`Cannot read the env file ${missing}`);
  });

  it('reads process.env by default and never changes it', async () => {
    const file = path.join(dir, '.env');
    await writeFile(file, 'AVI_TEST_ONLY_IN_FILE=1\nDATABASE_URL=postgres://file/app\n');
    const before = { ...process.env };
    const Config = defineConfig(v.object({ DATABASE_URL: v.string() }), { envFile: file });
    await Config.load();
    expect(process.env).toEqual(before);
    expect(process.env['AVI_TEST_ONLY_IN_FILE']).toBeUndefined();
  });

  it('shares one validated instance through Config.module', async () => {
    let loads = 0;
    const Config = defineConfig(
      v.pipe(
        v.object({ DATABASE_URL: v.string() }),
        v.transform((value) => {
          loads++;
          return value;
        }),
      ),
      { env: { DATABASE_URL: 'postgres://db/app' } },
    );

    @Injectable()
    class Db {
      static inject = [Config] as const;
      constructor(readonly config: { DATABASE_URL: string }) {}
    }
    @Module({ imports: [Config.module], providers: [Db], exports: [Db] })
    class DbModule {}
    @Module({ imports: [Config.module, DbModule] })
    class AppModule {}

    app = await AviFactory.create(AppModule);
    expect(app.get(Db).config).toBe(app.get(Config));
    expect(app.get(Config).DATABASE_URL).toBe('postgres://db/app');
    expect(loads).toBe(1);
  });

  it('stops the app from starting with bad config', async () => {
    const Config = defineConfig(schema, { env: {} });
    const instance = createAvi().register({ name: 'App', imports: [Config.module] });
    await expect(instance.listen(0, '127.0.0.1')).rejects.toThrow('Failed to create Config');
    await expect(instance.listen(0, '127.0.0.1')).rejects.toThrow(
      expect.objectContaining({ cause: expect.any(ConfigError) as unknown }),
    );
  });

  it('can be replaced with overrides in tests', async () => {
    const Config = defineConfig(schema, { env: {} });
    const fake = { PORT: 0, DATABASE_URL: 'postgres://test', LOG_LEVEL: 'info' as const };
    app = createAvi({ overrides: [{ provide: Config, useValue: fake }] }).register({
      imports: [Config.module],
    });
    await app.init();
    expect(app.get(Config)).toBe(fake);
  });

  it('works with the provider alone and a custom name', async () => {
    const Settings = defineConfig(v.object({ A: v.string() }), { name: 'Settings', env: {} });
    expect(Settings.provider.provide).toBe(Settings);
    await expect(Settings.load()).rejects.toThrow(/^Invalid Settings: A: /);
  });

  it('rejects something that is not a schema', () => {
    expect(() => defineConfig({} as never)).toThrow('defineConfig needs a Standard Schema');
  });
});
