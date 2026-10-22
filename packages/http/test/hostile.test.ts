// Requests a well-behaved client would never send.
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { RouteDefinition, ServerOptions } from '../src/index.js';
import { startServer, type TestServer } from './helpers.js';

let current: TestServer | undefined;

async function start(options: ServerOptions = {}) {
  const routes: RouteDefinition[] = [{ method: 'GET', path: '/', handler: () => 'ok' }];
  current = await startServer(routes, options);
  return current;
}

afterEach(async () => {
  await current?.server.close();
  current = undefined;
});

/** Sends raw bytes and resolves with everything the server writes before closing. */
function raw(port: number, data: string, { end = true } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (received += chunk));
    socket.on('close', () => {
      resolve(received);
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNRESET') resolve(received);
      else reject(error);
    });
    socket.write(data);
    if (end) socket.end();
  });
}

describe('hostile requests', () => {
  it('rejects oversized headers with 431', async () => {
    const { port } = await start();
    const response = await raw(
      port,
      `GET / HTTP/1.1\r\nHost: x\r\nX-Big: ${'a'.repeat(20_000)}\r\n\r\n`,
    );
    expect(response).toMatch(/^HTTP\/1\.1 431/);
  });

  it('rejects a malformed request line with 400', async () => {
    const { port } = await start();
    expect(await raw(port, 'NOT A REQUEST\r\n\r\n')).toMatch(/^HTTP\/1\.1 400/);
  });

  it('rejects an invalid header with 400', async () => {
    const { port } = await start();
    expect(await raw(port, 'GET / HTTP/1.1\r\nHost: x\r\nBad Header\r\n\r\n')).toMatch(
      /^HTTP\/1\.1 400/,
    );
  });

  it('closes connections that send headers too slowly', async () => {
    const { port } = await start({
      headersTimeout: 300,
      requestTimeout: 400,
      connectionsCheckingInterval: 50,
    });
    const started = Date.now();
    const response = await raw(port, 'GET / HTTP/1.1\r\nHost: x\r\n', { end: false });
    expect(response).toMatch(/^HTTP\/1\.1 408/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('still serves well-formed requests on the same server', async () => {
    const { port } = await start();
    const response = await raw(port, 'GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    expect(response).toMatch(/^HTTP\/1\.1 200[\s\S]*\r\n\r\nok$/);
  });
});
