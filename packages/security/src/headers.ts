import type { RequestHook } from '@avijs/http';
import { validateHeaderValue } from 'node:http';

export interface SecurityHeadersOptions {
  /** Default: `default-src 'none'; frame-ancestors 'none'`, for JSON APIs. Relax it to serve HTML. */
  contentSecurityPolicy?: string | false;
  /** Default: `max-age=31536000; includeSubDomains`. Browsers only honor it over HTTPS. */
  strictTransportSecurity?: string | false;
  /** Default: `DENY`. */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** Default: `no-referrer`. */
  referrerPolicy?: string | false;
  /** Default: `same-origin`. Use `cross-origin` for public assets embedded elsewhere. */
  crossOriginResourcePolicy?: 'same-origin' | 'same-site' | 'cross-origin' | false;
}

/**
 * Common security headers as an `onRequest` hook. Pass `false` to leave one out. Headers set by
 * a handler with `reply()` win. `X-Content-Type-Options: nosniff` is always sent by Avi.js.
 */
export function securityHeaders(options: SecurityHeadersOptions = {}): RequestHook {
  const entries: [string, string][] = [];
  const add = (name: string, value: string | false | undefined, fallback: string) => {
    if (value === false) return;
    const resolved = value ?? fallback;
    validateHeaderValue(name, resolved);
    entries.push([name, resolved]);
  };

  add(
    'content-security-policy',
    options.contentSecurityPolicy,
    "default-src 'none'; frame-ancestors 'none'",
  );
  add(
    'strict-transport-security',
    options.strictTransportSecurity,
    'max-age=31536000; includeSubDomains',
  );
  add('x-frame-options', options.frameOptions, 'DENY');
  add('referrer-policy', options.referrerPolicy, 'no-referrer');
  add('cross-origin-resource-policy', options.crossOriginResourcePolicy, 'same-origin');

  return (ctx) => {
    for (const [name, value] of entries) ctx.setHeader(name, value);
    return undefined;
  };
}
