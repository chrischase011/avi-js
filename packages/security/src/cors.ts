import { reply, type RequestHook } from '@avijs/http';
import type { OutgoingHttpHeaders } from 'node:http';

export type CorsOrigin = string | readonly string[] | RegExp | ((origin: string) => boolean);

export interface CorsOptions {
  /**
   * Origins allowed to call the API: `'*'` for any, an origin like `'https://app.example.com'`,
   * a list, a RegExp or a function.
   */
  origin: CorsOrigin;
  /** Methods allowed in preflights. Default: GET, HEAD, PUT, PATCH, POST, DELETE. */
  methods?: readonly string[];
  /** Request headers allowed in preflights. Default: the headers the browser asks for. */
  allowedHeaders?: readonly string[];
  /** Response headers the browser may read. */
  exposedHeaders?: readonly string[];
  /** Allow cookies and `Authorization`. Requires explicit origins. */
  credentials?: boolean;
  /** How long browsers may cache a preflight, in seconds. */
  maxAge?: number;
}

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];
const VISIBLE_ASCII = /^[!-~]+$/;
const TOKEN_LIST = /^[\w!#$%&'*+.^`|~-]+(?:[ \t]*,[ \t]*[\w!#$%&'*+.^`|~-]+)*$/;

/** CORS as an `onRequest` hook: answers preflights and adds headers to allowed origins. */
export function cors(options: CorsOptions): RequestHook {
  const any = options.origin === '*';
  const allows = originMatcher(options.origin);
  const credentials = options.credentials === true;
  if (any && credentials) {
    throw new TypeError("cors: credentials cannot be used with origin '*'; list the origins");
  }
  const methods = (options.methods ?? DEFAULT_METHODS).join(', ');
  const allowedHeaders = options.allowedHeaders?.join(', ');
  const exposed = options.exposedHeaders?.length ? options.exposedHeaders.join(', ') : undefined;
  const maxAge = options.maxAge === undefined ? undefined : seconds(options.maxAge);

  return (ctx) => {
    if (!any) ctx.setHeader('vary', 'Origin');
    const origin = ctx.headers.origin;
    if (origin === undefined || !VISIBLE_ASCII.test(origin) || !allows(origin)) return undefined;

    const allowOrigin = any ? '*' : origin;
    const requestMethod = ctx.headers['access-control-request-method'];
    if (ctx.method === 'OPTIONS' && requestMethod !== undefined) {
      const headers: OutgoingHttpHeaders = {
        'access-control-allow-origin': allowOrigin,
        'access-control-allow-methods': methods,
      };
      if (credentials) headers['access-control-allow-credentials'] = 'true';
      if (maxAge !== undefined) headers['access-control-max-age'] = maxAge;
      if (allowedHeaders !== undefined) {
        headers['access-control-allow-headers'] = allowedHeaders;
      } else {
        headers.vary = any
          ? 'Access-Control-Request-Headers'
          : 'Origin, Access-Control-Request-Headers';
        const requested = ctx.headers['access-control-request-headers'];
        if (requested !== undefined && TOKEN_LIST.test(requested)) {
          headers['access-control-allow-headers'] = requested;
        }
      }
      return reply(undefined, { status: 204, headers });
    }

    ctx.setHeader('access-control-allow-origin', allowOrigin);
    if (credentials) ctx.setHeader('access-control-allow-credentials', 'true');
    if (exposed !== undefined) ctx.setHeader('access-control-expose-headers', exposed);
    return undefined;
  };
}

function originMatcher(origin: CorsOrigin): (value: string) => boolean {
  if (origin === '*') return () => true;
  if (typeof origin === 'function') return origin;
  if (origin instanceof RegExp) {
    return (value) => {
      origin.lastIndex = 0;
      return origin.test(value);
    };
  }
  const list = typeof origin === 'string' ? [origin] : origin;
  if (!Array.isArray(list) || list.length === 0) {
    throw new TypeError('cors: origin must be set');
  }
  const allowed = new Set(list.map(checkOrigin));
  return (value) => allowed.has(value);
}

function checkOrigin(value: string): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(value);
  } catch {
    parsed = undefined;
  }
  if (parsed?.origin !== value) {
    throw new TypeError(
      `cors: '${value}' is not an origin. Use scheme, host and optional port, like 'https://example.com'`,
    );
  }
  return value;
}

function seconds(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`cors: maxAge must be a non-negative integer, got ${String(value)}`);
  }
  return String(value);
}
