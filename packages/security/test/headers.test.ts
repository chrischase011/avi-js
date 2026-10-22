import { HttpServer, Router, reply } from '@avijs/http';
import { afterEach, describe, expect, it } from 'vitest';
import { securityHeaders, type SecurityHeadersOptions } from '../src/index.js';

let server: HttpServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(options?: SecurityHeadersOptions): Promise<string> {
  const router = new Router();
  router.add([
    { method: 'GET', path: '/', handler: () => ({ ok: true }) },
    {
      method: 'GET',
      path: '/page',
      handler: () =>
        reply('<p>hi</p>', { headers: { 'content-security-policy': "default-src 'self'" } }),
    },
  ]);
  server = new HttpServer(router, { onRequest: [securityHeaders(options)] });
  const { port } = await server.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${String(port)}`;
}

describe('securityHeaders', () => {
  it('sends safe defaults on responses and errors', async () => {
    const url = await start();
    for (const path of ['/', '/missing']) {
      const res = await fetch(`${url}${path}`);
      expect(
        Object.fromEntries(
          [
            'content-security-policy',
            'strict-transport-security',
            'x-frame-options',
            'referrer-policy',
            'cross-origin-resource-policy',
            'x-content-type-options',
          ].map((name) => [name, res.headers.get(name)]),
        ),
      ).toEqual({
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'cross-origin-resource-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
      });
    }
  });

  it('lets reply() headers win', async () => {
    const url = await start();
    const res = await fetch(`${url}/page`);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'");
  });

  it('takes custom values and leaves out headers set to false', async () => {
    const url = await start({
      strictTransportSecurity: false,
      frameOptions: 'SAMEORIGIN',
      crossOriginResourcePolicy: false,
    });
    const res = await fetch(url);
    expect(res.headers.get('strict-transport-security')).toBeNull();
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('cross-origin-resource-policy')).toBeNull();
  });

  it('rejects header values that would break the response', () => {
    expect(() => securityHeaders({ referrerPolicy: 'no-referrer\r\nx-injected: 1' })).toThrow();
  });
});
