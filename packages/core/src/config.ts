import { createToken, type FactoryProvider, type InjectionToken } from '@avijs/di';
import type { InferOutput, StandardSchemaV1 } from '@avijs/validation';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { defineModule, type AviModule } from './module.js';

export interface ConfigOptions {
  /** Name of the token in errors and manifests. Default: `Config`. */
  name?: string;
  /**
   * A `.env` file to read. Environment variables that are already set win over it. A missing file
   * is skipped unless `required` is set.
   */
  envFile?: string | { path: string; required?: boolean };
  /** The variables to validate. Default: `process.env`. Mostly for tests. */
  env?: Readonly<Record<string, string | undefined>>;
}

/** A config token: inject it like any other, register it with `.module` or `.provider`. */
export interface ConfigToken<T> extends InjectionToken<T> {
  /** A module that provides and exports the config. Import it wherever the config is needed. */
  readonly module: AviModule;
  /** The provider alone, for registering the config yourself. */
  readonly provider: FactoryProvider<T>;
  /** Reads and validates the config now, outside dependency injection. */
  load(): Promise<T>;
}

const CONFIG = Symbol('avi.config');

/** True for tokens made by `defineConfig`. */
export function isConfigToken(value: unknown): value is ConfigToken<unknown> {
  return typeof value === 'object' && value !== null && CONFIG in value;
}

/** Thrown when the environment does not match the config schema. Never contains the values. */
export class ConfigError extends Error {
  constructor(
    readonly issues: readonly { readonly key: string; readonly message: string }[],
    name: string,
  ) {
    super(
      `Invalid ${name === 'Config' ? 'configuration' : name}: ${issues.map((i) => `${i.key}: ${i.message}`).join('; ')}`,
    );
    this.name = 'ConfigError';
  }
}

/**
 * Typed configuration from environment variables, validated with any Standard Schema library.
 * The app does not start while a variable is missing or invalid.
 */
export function defineConfig<S extends StandardSchemaV1>(
  schema: S,
  options: ConfigOptions = {},
): ConfigToken<InferOutput<S>> {
  if (typeof (schema as Partial<StandardSchemaV1> | null)?.['~standard']?.validate !== 'function') {
    throw new TypeError('defineConfig needs a Standard Schema, such as v.object() or z.object()');
  }
  const name = options.name ?? 'Config';
  const file = typeof options.envFile === 'string' ? { path: options.envFile } : options.envFile;
  const token = createToken<InferOutput<S>>(name);

  const load = async (): Promise<InferOutput<S>> => {
    const fromFile = file ? await readEnvFile(file.path, file.required ?? false) : {};
    const env: Record<string, string> = { ...fromFile };
    for (const [key, value] of Object.entries(options.env ?? process.env)) {
      if (value !== undefined) env[key] = value;
    }

    const result = await Promise.resolve()
      .then(() => schema['~standard'].validate(env))
      .catch(() => {
        // A throwing transform's message may quote the value: not kept, not even as cause.
        throw new ConfigError(
          [{ key: '(config)', message: 'the schema threw while reading the variables' }],
          name,
        );
      });
    if (!result.issues) return result.value;
    throw new ConfigError(
      result.issues.map((issue) => {
        const segment = issue.path?.[0];
        const key = String(typeof segment === 'object' ? segment.key : (segment ?? '(config)'));
        // An issue about the whole config may quote any variable.
        const values = segment === undefined ? Object.values(env) : [env[key]];
        return { key, message: redact(issue.message, values) };
      }),
      name,
    );
  };

  // The returned object is the token itself, so injecting `Config` finds this provider.
  const config = { description: token.description, load } as {
    -readonly [K in keyof ConfigToken<InferOutput<S>>]: ConfigToken<InferOutput<S>>[K];
  };
  config.provider = { provide: config, useFactory: load };
  config.module = defineModule({ name, providers: [config.provider], exports: [config] });
  Object.defineProperty(config, CONFIG, { value: true });
  return Object.freeze(config);
}

async function readEnvFile(path: string, required: boolean): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read the env file ${path}`, { cause: error });
  }
  return parseEnv(text) as Record<string, string>;
}

// Libraries quote the received value in messages, sometimes after a transform trimmed or cut it,
// and config values can be secrets. Quoted text that is part of the value, or holds it, goes, and
// the raw value wherever it still appears. Names and allowed values stay readable.
function redact(message: string, values: readonly (string | undefined)[]): string {
  const secrets = values.filter((value): value is string => Boolean(value));
  if (secrets.length === 0) return message;
  const raws = secrets.map((value) => value.toLowerCase());
  let text = message.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (quoted) => {
    const inner = quoted.slice(1, -1).toLowerCase();
    const related = raws.some((raw) => raw.includes(inner) || inner.includes(raw));
    return inner && related ? '"[redacted]"' : quoted;
  });
  // Very short values would match inside other words and numbers.
  for (const value of secrets) if (value.length >= 4) text = text.replaceAll(value, '[redacted]');
  return text;
}
