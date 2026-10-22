// Random raw requests must never crash the server or stop it serving well-formed ones.
import fc from 'fast-check';
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await startServer(
    [
      { method: 'GET', path: '/', handler: () => 'ok' },
      { method: 'GET', path: '/users/:id', handler: (ctx) => ({ id: ctx.params['id'] }) },
      { method: 'POST', path: '/echo', handler: (ctx) => ctx.text() },
      { method: 'GET', path: '/files/*', handler: (ctx) => ctx.params['*'] ?? '' },
    ],
    { bodyLimit: 1024 },
  );
});

afterAll(async () => {
  await server.server.close();
});

/** Sends bytes and resolves with the first response line, or '' if the server just closed. */
function send(payload: Buffer): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(server.port, '127.0.0.1');
    let received = '';
    const done = () => {
      socket.destroy();
      resolve(received.split('\r\n')[0] ?? '');
    };
    socket.setTimeout(2000, done);
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => {
      received += chunk;
      if (received.includes('\r\n')) done();
    });
    socket.on('close', done);
    socket.on('error', done);
    socket.end(payload);
  });
}

const token = fc.stringMatching(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,10}$/);
const anyText = fc.string({ unit: 'binary', maxLength: 80 });
const method = fc.oneof(
  fc.constantFrom('GET', 'POST', 'HEAD', 'OPTIONS', 'DELETE', 'PATCH'),
  token,
);
const target = fc.oneof(
  fc.constantFrom('/', '/users/1', '/echo', '/files/a/b', '*', '//', '/%', '/%E0%A4', '/..%2F..'),
  anyText.map((text) => `/${text}`),
);
const header = fc.tuple(token, anyText).map(([name, value]) => `${name}: ${value}`);

const request = fc
  .record({
    method,
    target,
    version: fc.constantFrom('HTTP/1.1', 'HTTP/1.0', 'HTTP/2.0', 'HTTP/x'),
    headers: fc.array(header, { maxLength: 5 }),
    body: fc.oneof(fc.constant(''), anyText),
    framing: fc.constantFrom('length', 'chunked', 'none', 'lying'),
  })
  .map(({ method, target, version, headers, body, framing }) => {
    const lines = [`${method} ${target} ${version}`, 'Host: fuzz', ...headers];
    if (framing === 'length')
      lines.push(`Content-Length: ${String(Buffer.byteLength(body, 'latin1'))}`);
    if (framing === 'lying') lines.push('Content-Length: 99999');
    if (framing === 'chunked') {
      lines.push('Transfer-Encoding: chunked');
      body = `${Buffer.byteLength(body, 'latin1').toString(16)}\r\n${body}\r\n0\r\n\r\n`;
    }
    lines.push('Connection: close');
    return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${body}`, 'latin1');
  });

describe('HTTP fuzzing', () => {
  it('answers or closes for any request, and keeps serving', { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(request, async (payload) => {
        const line = await send(payload);
        expect(line === '' || /^HTTP\/1\.[01] \d{3} /.test(line)).toBe(true);
      }),
      { numRuns: 150 },
    );

    const health = await fetch(`${server.url}/`);
    expect(await health.text()).toBe('ok');
    expect(server.logger.error).not.toHaveBeenCalled();
  });

  it('never answers with a 5xx for request-level garbage', { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(request, async (payload) => {
        expect(await send(payload)).not.toMatch(/^HTTP\/1\.[01] 5\d\d /);
      }),
      { numRuns: 100 },
    );
  });
});
