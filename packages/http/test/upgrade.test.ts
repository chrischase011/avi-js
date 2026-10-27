import { request } from 'node:http';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { UpgradeHandler } from '../src/index.js';
import { startServer, type TestServer } from './helpers.js';

let running: TestServer | undefined;
afterEach(async () => {
  await running?.server.close();
  running = undefined;
});

const ok = [{ method: 'GET' as const, path: '/', handler: () => 'plain' }];

/** Accepts the upgrade and echoes what the client sends. */
const echo: UpgradeHandler = (_req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n');
  socket.pipe(socket);
};

/** Asks to upgrade and resolves with the socket, or with the status when the server says no. */
function upgrade(port: number): Promise<{ socket: Duplex } | { status: number }> {
  return new Promise((resolve, reject) => {
    const req = request({
      port,
      host: '127.0.0.1',
      headers: { connection: 'Upgrade', upgrade: 'echo' },
    });
    req.on('upgrade', (_res, socket) => {
      resolve({ socket });
    });
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on('error', reject);
    req.end();
  });
}

const send = (socket: Duplex, text: string) =>
  new Promise<string>((resolve) => {
    socket.once('data', (data: Buffer) => {
      resolve(data.toString());
    });
    socket.write(text);
  });

describe('onUpgrade', () => {
  it('hands upgrade requests to the handler, and plain requests still route', async () => {
    running = await startServer(ok, { onUpgrade: echo });
    const result = await upgrade(running.port);
    if (!('socket' in result)) throw new Error(`no upgrade: ${String(result.status)}`);
    expect(await send(result.socket, 'ping')).toBe('ping');
    result.socket.destroy();
    expect(await (await fetch(running.url)).text()).toBe('plain');
  });

  it('aborts the signal on close, so the handler can end its connections', async () => {
    let signal: AbortSignal | undefined;
    running = await startServer(ok, {
      shutdownTimeout: 5_000,
      onUpgrade: (req, socket, head, abort) => {
        signal = abort;
        echo(req, socket, head, abort);
        abort.addEventListener('abort', () => socket.end());
      },
    });
    const result = await upgrade(running.port);
    if (!('socket' in result)) throw new Error('no upgrade');
    result.socket.resume();
    const started = Date.now();
    await running.server.close();
    running = undefined;
    expect(signal?.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('gives each connection its own signal and forgets closed ones', async () => {
    const signals: AbortSignal[] = [];
    running = await startServer(ok, {
      shutdownTimeout: 300,
      onUpgrade: (req, socket, head, signal) => {
        signals.push(signal);
        echo(req, socket, head, signal);
      },
    });
    for (let i = 0; i < 3; i++) {
      const result = await upgrade(running.port);
      if (!('socket' in result)) throw new Error('no upgrade');
      const closed = new Promise<void>((resolve) => {
        result.socket.once('close', () => {
          resolve();
        });
      });
      result.socket.destroy();
      await closed;
    }
    const open = await upgrade(running.port);
    if (!('socket' in open)) throw new Error('no upgrade');
    open.socket.resume();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(new Set(signals).size).toBe(4);

    await running.server.close();
    running = undefined;
    // Only the connection still open hears about shutdown; closed ones hold nothing.
    expect(signals.map((s) => s.aborted)).toEqual([false, false, false, true]);
  });

  it('destroys upgraded connections left open after shutdownTimeout', async () => {
    running = await startServer(ok, { shutdownTimeout: 200, onUpgrade: echo });
    const result = await upgrade(running.port);
    if (!('socket' in result)) throw new Error('no upgrade');
    const closed = new Promise<void>((resolve) => {
      result.socket.once('close', () => {
        resolve();
      });
    });
    result.socket.resume();
    await running.server.close();
    running = undefined;
    await closed;
  });

  it('logs a failing handler and drops its connection', async () => {
    running = await startServer(ok, {
      onUpgrade: () => {
        throw new Error('boom');
      },
    });
    const outcome = await upgrade(running.port).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(Error);
    const [message, error] = (running.logger.error.mock.calls[0] ?? []) as [string?, Error?];
    expect(message).toBe('Upgrade handler failed: GET /');
    expect(error?.message).toBe('boom');
  });

  it('leaves upgrade requests to Node when there is no handler', async () => {
    running = await startServer(ok);
    const outcome = await upgrade(running.port).catch((error: unknown) => error);
    // Node answers them as plain requests or drops them, depending on its version; neither upgrades.
    expect(outcome).not.toHaveProperty('socket');
  });
});
