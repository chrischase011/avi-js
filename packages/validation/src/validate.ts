import { HttpError, isReply, reply, type Context, type Handler } from '@avijs/http';
import type { StandardSchemaIssue, StandardSchemaV1 } from './standard-schema.js';
import type { RouteSchema } from './types.js';

export interface ValidationIssue {
  readonly in: 'params' | 'query' | 'body';
  readonly path: readonly (string | number)[];
  readonly message: string;
}

const PARTS = ['params', 'query', 'body'] as const;

/** Throws if `schema` has a part that is not a Standard Schema. `where` labels the error. */
export function checkRouteSchema(schema: unknown, where: string): RouteSchema | undefined {
  if (schema === undefined) return undefined;
  if (typeof schema !== 'object' || schema === null) {
    throw new TypeError(`${where} schema must be an object`);
  }
  for (const [part, value] of Object.entries(schema)) {
    if (![...PARTS, 'response'].includes(part)) {
      throw new TypeError(`${where} schema has an unknown part "${part}"`);
    }
    if (value !== undefined && !isStandardSchema(value)) {
      throw new TypeError(`${where} schema.${part} is not a Standard Schema`);
    }
  }
  return schema;
}

/**
 * Wraps `handler` so params, query and body are validated first and stored on `ctx.input`.
 * All issues are reported together as a 400.
 */
export function withValidation(schema: RouteSchema, handler: Handler): Handler {
  return async (ctx) => {
    (ctx as { input: unknown }).input = await validateInput(schema, ctx);
    const result: unknown = await handler(ctx);
    return schema.response ? validateResponse(schema.response, result) : result;
  };
}

async function validateInput(schema: RouteSchema, ctx: Context): Promise<object> {
  const input: Record<string, unknown> = {};
  const issues: ValidationIssue[] = [];
  let truncated = false;

  for (const part of PARTS) {
    const partSchema = schema[part];
    if (!partSchema) continue;
    const raw =
      part === 'params' ? ctx.params : part === 'query' ? queryObject(ctx.query) : await ctx.json();
    const result = await partSchema['~standard'].validate(raw);
    if (!result.issues) {
      input[part] = result.value;
      continue;
    }
    // A loop, not push(...issues): a body can produce more issues than a call takes arguments.
    for (const issue of result.issues) {
      if (issues.length === MAX_ISSUES) {
        truncated = true;
        break;
      }
      issues.push(toIssue(part, issue));
    }
  }

  if (issues.length > 0) {
    throw new HttpError(400, 'Validation failed', {
      details: truncated ? { issues, truncated } : { issues },
    });
  }
  return Object.freeze(input);
}

async function validateResponse(schema: StandardSchemaV1, value: unknown): Promise<unknown> {
  const body = isReply(value) ? value.body : value;
  const result = await schema['~standard'].validate(body);
  if (result.issues) {
    throw new Error('Response does not match its schema', {
      cause: result.issues.map((issue) => toIssue('body', issue)),
    });
  }
  return isReply(value)
    ? reply(result.value, { status: value.status, headers: value.headers })
    : result.value;
}

/** Query parameters as an object: one value is a string, a repeated key is a string array. */
export function queryObject(query: URLSearchParams): Record<string, string | string[]> {
  const out = Object.create(null) as Record<string, string | string[]>;
  for (const [key, value] of query) {
    const previous = out[key];
    if (previous === undefined) out[key] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else out[key] = [previous, value];
  }
  return out;
}

// A 400 stays small whatever the body: issues, their messages and their paths come from the
// request, and schema libraries may quote the input in messages.
const MAX_ISSUES = 50;
const MAX_MESSAGE = 300;
const MAX_PATH = 32;
const MAX_KEY = 100;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function toIssue(part: ValidationIssue['in'], issue: StandardSchemaIssue): ValidationIssue {
  const path = (issue.path ?? []).slice(0, MAX_PATH).map((segment) => {
    const key = typeof segment === 'object' ? segment.key : segment;
    if (typeof key === 'number') return key;
    return clip(typeof key === 'symbol' ? String(key) : key, MAX_KEY);
  });
  return { in: part, path, message: clip(issue.message, MAX_MESSAGE) };
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  const props =
    typeof value === 'object' || typeof value === 'function'
      ? (value as Partial<StandardSchemaV1> | null)?.['~standard']
      : undefined;
  return typeof props?.validate === 'function';
}
