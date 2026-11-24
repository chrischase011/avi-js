import { request, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, upgrade, type RouteDefinition, type UpgradeConnection } from '../src/index.js';
import { startServer, type TestServer } from './helpers.js';

let running: TestServer | undefined;
afterEach(async () => {
  await running?.server.close();
  running = undefined;
});

type Outcome =
  | { socket: Duplex; headers: IncomingHttpHeaders }
  | { status: number; headers: IncomingHttpHeaders; body: Promise<string> };

/** Asks to upgrade and resolves with the socket, or with the response when the server says no. */
function ask(port: number, path: string, protocol = 'echo'): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const req = request({
      port,
      path,
      host: '127.0.0.1',
      headers: { connection: 'Upgrade', upgrade: protocol },
    });
    req.on('upgrade', (res, socket) => {
      resolve({ socket, headers: res.headers });
    });
    req.on('response', (res) => {
      const body = new Promise<string>((done) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString()));
        res.on('end', () => {
          done(text);
        });
      });
      resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
    });
    req.on('error', reject);
    req.end();
  });
}

function refused(outcome: Outcome) {
  if ('socket' in outcome) throw new Error('upgraded');
  return outcome;
}

function accepted(outcome: Outcome) {
  if (!('socket' in outcome)) throw new Error(`not upgraded: ${String(outcome.status)}`);
  return outcome;
}

const send = (socket: Duplex, text: string) =>
  new Promise<string>((resolve) => {
    socket.once('data', (data: Buffer) => {
      resolve(data.toString());
    });
    socket.write(text);
  });

/** Writes the 101 with the headers it was given, then echoes. */
function echo({ socket, head, headers }: UpgradeConnection): void {
  const extra = Object.entries(headers).map(([name, value]) => `${name}: ${String(value)}\r\n`);
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n${extra.join('')}\r\n`,
  );
  if (head.length > 0) socket.write(head);
  socket.pipe(socket);
}

const plain: RouteDefinition = { method: 'GET', path: '/', handler: () => 'plain' };

const echoRoute = (accept: (connection: UpgradeConnection) => unknown = echo): RouteDefinition => ({
  method: 'GET',
  path: '/echo',
  handler: (ctx) => upgrade(ctx, accept, { protocol: 'echo' }),
});

describe('upgrade()', () => {
  it('hands the connection to the route that accepts it', async () => {
    running = await startServer([plain, echoRoute()]);
    const { socket, headers } = accepted(await ask(running.port, '/echo'));
    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(await send(socket, 'ping')).toBe('ping');
    socket.destroy();
    expect(await (await fetch(running.url)).text()).toBe('plain');
  });

  it('runs request hooks first, and sends a refusal as a response', async () => {
    running = await startServer([echoRoute()], {
      onRequest: [
        () => {
          throw new HttpError(401);
        },
      ],
    });
    const result = refused(await ask(running.port, '/echo'));
    expect(result.status).toBe(401);
    expect(result.headers.connection).toBe('close');
    expect(await result.body).toContain('Unauthorized');
  });

  it('answers upgrade requests for other routes as usual, then closes the connection', async () => {
    running = await startServer([plain, echoRoute()]);
    const other = refused(await ask(running.port, '/'));
    expect(other.status).toBe(200);
    expect(await other.body).toBe('plain');
    expect(other.headers.connection).toBe('close');
    expect(refused(await ask(running.port, '/nope')).status).toBe(404);
  });

  it('gives plain requests and other protocols a 426', async () => {
    running = await startServer([echoRoute()]);
    const res = await fetch(`${running.url}/echo`);
    expect(res.status).toBe(426);
    expect(res.headers.get('upgrade')).toBe('echo');
    expect(refused(await ask(running.port, '/echo', 'websocket')).status).toBe(426);
  });

  it('reports an accepted upgrade to onResponse as a 101 once the connection ends', async () => {
    const onResponse = vi.fn();
    running = await startServer([echoRoute()], { onResponse });
    const { socket } = accepted(await ask(running.port, '/echo'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onResponse).not.toHaveBeenCalled();
    socket.destroy();
    await vi.waitFor(() => {
      expect(onResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: 101, path: '/echo', aborted: false }),
      );
    });
  });

  it('aborts the signal on close, and destroys connections left open', async () => {
    let signal: AbortSignal | undefined;
    running = await startServer(
      [
        echoRoute((connection) => {
          signal = connection.signal;
          echo(connection);
        }),
      ],
      { shutdownTimeout: 300 },
    );
    const { socket } = accepted(await ask(running.port, '/echo'));
    socket.resume();
    const closed = new Promise((resolve) => socket.once('close', resolve));
    await running.server.close();
    running = undefined;
    expect(signal?.aborted).toBe(true);
    await closed;
  });

  it('refuses an upgrade the route accepts after shutdown started', async () => {
    let release: (() => void) | undefined;
    running = await startServer([echoRoute()], {
      shutdownTimeout: 1_000,
      onRequest: [
        () =>
          new Promise<undefined>((resolve) => {
            release = () => {
              resolve(undefined);
            };
          }),
      ],
    });
    const pending = ask(running.port, '/echo');
    await vi.waitFor(() => {
      expect(release).toBeDefined();
    });
    const closing = running.server.close();
    release?.();
    expect(refused(await pending).status).toBe(503);
    await closing;
    running = undefined;
  });

  it('logs a failing accept and drops its connection', async () => {
    running = await startServer([
      echoRoute(() => {
        throw new Error('boom');
      }),
    ]);
    const outcome = await ask(running.port, '/echo').catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(Error);
    const [message, error] = (running.logger.error.mock.calls[0] ?? []) as [string?, Error?];
    expect(message).toBe('Upgrade handler failed: GET /echo');
    expect(error?.message).toBe('boom');
  });

  it('survives a client that resets before the route answers', async () => {
    let signal: AbortSignal | undefined;
    const answered = vi.fn();
    running = await startServer([
      {
        method: 'GET',
        path: '/slow',
        handler: async (ctx) => {
          signal = ctx.signal;
          await new Promise((resolve) => setTimeout(resolve, 100));
          answered();
          return 'late';
        },
      },
    ]);
    const client = connect(running.port, '127.0.0.1');
    client.on('error', () => undefined);
    client.write('GET /slow HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n');
    await vi.waitFor(() => {
      expect(signal).toBeDefined();
    });
    client.resetAndDestroy();
    await vi.waitFor(() => {
      expect(answered).toHaveBeenCalled();
    });
    // Nobody reads the socket before the upgrade, so the reset shows when the answer is written.
    await vi.waitFor(() => {
      expect(signal?.aborted).toBe(true);
    });
    expect(running.logger.error).not.toHaveBeenCalled();
    const started = Date.now();
    await running.server.close();
    running = undefined;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reads an upgrade request body as empty instead of waiting', async () => {
    running = await startServer([
      {
        method: 'GET',
        path: '/text',
        handler: async (ctx) => `[${await ctx.text()}]`,
      },
    ]);
    const result = refused(await ask(running.port, '/text'));
    expect(await result.body).toBe('[]');
  });
});

describe('upgrade requests with a body', () => {
  it('reads them as plain requests, body and keep-alive included', async () => {
    running = await startServer([
      { method: 'POST', path: '/p', handler: async (ctx) => `got ${await ctx.text()}` },
    ]);
    const res = await new Promise<{ status: number; body: string; connection?: string }>(
      (resolve, reject) => {
        const req = request(
          {
            port: running?.port,
            host: '127.0.0.1',
            path: '/p',
            method: 'POST',
            headers: { connection: 'Upgrade', upgrade: 'h2c', 'content-length': '5' },
          },
          (response) => {
            let body = '';
            response.on('data', (chunk: Buffer) => (body += chunk.toString()));
            response.on('end', () => {
              resolve({
                status: response.statusCode ?? 0,
                body,
                connection: response.headers.connection,
              });
            });
          },
        );
        req.on('error', reject);
        req.end('hello');
      },
    );
    expect(res).toEqual({ status: 200, body: 'got hello', connection: 'keep-alive' });
  });
});
