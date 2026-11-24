import {
  Controller,
  Get,
  HttpError,
  Injectable,
  Module,
  UseGuards,
  createAvi,
  defineController,
  type AviApp,
  type AviOptions,
  type Context,
  type Route,
  type TokenType,
} from '@avijs/core';
import { defineChannel, definePubSub } from '@avijs/pubsub';
import { createTestClient } from '@avijs/testing';
import * as v from 'valibot';
import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type ClientOptions } from 'ws';
import { websocket, type WebSocketConnection } from '../src/index.js';

let app: AviApp | undefined;
const clients: WebSocket[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await app?.close();
  app = undefined;
});

const logger = () => ({ error: vi.fn() });

async function serve(routes: Route[], options: AviOptions = {}): Promise<string> {
  app = createAvi({ logger: logger(), ...options }).register({
    controllers: [defineController({ routes })],
  });
  const { port } = await app.listen(0, '127.0.0.1');
  return `ws://127.0.0.1:${String(port)}`;
}

interface Opened {
  ws: WebSocket;
  headers: Record<string, string | string[] | undefined>;
  /** The first message, listened for from the start: it can arrive with the 101. */
  first: Promise<string>;
}

/** Connects, resolving with the open socket or the HTTP status of the refusal. */
function connect(
  url: string,
  options: ClientOptions & { protocols?: string[] } = {},
): Promise<Opened | { status: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options.protocols, options);
    clients.push(ws);
    let headers: Opened['headers'] = {};
    const first = next(ws);
    ws.once('upgrade', (res) => (headers = res.headers));
    ws.once('open', () => {
      resolve({ ws, headers, first });
    });
    ws.once('unexpected-response', (_req, res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    ws.once('error', reject);
  });
}

async function open(url: string, options?: Parameters<typeof connect>[1]): Promise<Opened> {
  const result = await connect(url, options);
  if (!('ws' in result)) throw new Error(`refused: ${String(result.status)}`);
  return result;
}

const next = (ws: WebSocket) =>
  new Promise<string>((resolve) => {
    ws.once('message', (data: Buffer, binary: boolean) => {
      resolve(binary ? `binary:${data.toString('hex')}` : data.toString());
    });
  });

const closed = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) => {
    ws.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });

const echo: Route = {
  method: 'GET',
  path: '/echo',
  handler: (ctx) =>
    websocket(ctx, async (socket) => {
      for await (const message of socket) await socket.send(message);
    }),
};

describe('websocket()', () => {
  it('echoes text and binary messages', async () => {
    const { ws } = await open(`${await serve([echo])}/echo`);
    ws.send('hello');
    expect(await next(ws)).toBe('hello');
    ws.send(Buffer.from([1, 2, 255]));
    expect(await next(ws)).toBe('binary:0102ff');
  });

  it('sends anything but strings and bytes as JSON', async () => {
    const url = await serve([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) =>
          websocket(ctx, async (socket) => {
            await socket.send({ hello: ctx.query.get('name') });
          }),
      },
    ]);
    const { first } = await open(`${url}/?name=joy`);
    expect(JSON.parse(await first)).toEqual({ hello: 'joy' });
  });

  it('keeps the first 16 messages that arrive before the handler reads, in order', async () => {
    const url = await serve([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) =>
          websocket(ctx, async (socket) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            const seen: unknown[] = [];
            for await (const message of socket) {
              seen.push(message);
              if (message === 'last') break;
            }
            await socket.send(seen.join(','));
          }),
      },
    ]);
    const { ws } = await open(url);
    const reply = next(ws);
    for (let i = 0; i < 20; i++) ws.send(String(i));
    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.send('last');
    const kept = Array.from({ length: 16 }, (_, i) => String(i));
    expect(await reply).toBe([...kept, 'last'].join(','));
  });

  it('holds a fast client back while the handler reads slowly, pings and all', async () => {
    const url = await serve([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) =>
          websocket(
            ctx,
            async (socket) => {
              let count = 0;
              for await (const message of socket) {
                await new Promise((resolve) => setTimeout(resolve, 20));
                if (++count === 40) await socket.send(`done ${String(message)}`);
              }
            },
            { heartbeat: 50 },
          ),
      },
    ]);
    const { ws } = await open(url);
    const reply = next(ws);
    for (let i = 0; i < 40; i++) ws.send(String(i));
    expect(await reply).toBe('done 39');
  });

  it('keeps a client that sends to a handler that never reads', async () => {
    let socket: WebSocketConnection | undefined;
    const url = await serve([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) =>
          websocket(
            ctx,
            async (s) => {
              socket = s;
              await new Promise((resolve) => {
                s.signal.addEventListener('abort', resolve);
              });
            },
            { heartbeat: 40 },
          ),
      },
    ]);
    const { ws } = await open(url);
    for (let i = 0; i < 40; i++) ws.send(String(i));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await vi.waitFor(() => {
      expect(socket?.signal.aborted).toBe(true);
    });
  });

  it('gives plain requests a 426', async () => {
    const url = (await serve([echo])).replace('ws:', 'http:');
    const res = await fetch(`${url}/echo`);
    expect(res.status).toBe(426);
    expect(res.headers.get('upgrade')).toBe('websocket');
  });

  it('refuses a broken handshake with an ordinary response that onResponse sees', async () => {
    const onResponse = vi.fn();
    const url = await serve([echo], { onResponse });
    const { port } = new URL(url);
    const ask = (headers: Record<string, string>) =>
      new Promise<{ status: number; version?: string }>((resolve, reject) => {
        const req = request({
          port,
          host: '127.0.0.1',
          path: '/echo',
          headers: { connection: 'Upgrade', upgrade: 'websocket', ...headers },
        });
        req.on('response', (res) => {
          res.resume();
          resolve({
            status: res.statusCode ?? 0,
            version: res.headers['sec-websocket-version'],
          });
        });
        req.on('error', reject);
        req.end();
      });
    const key = 'dGhlIHNhbXBsZSBub25jZQ==';
    expect(await ask({ 'sec-websocket-version': '13' })).toEqual({ status: 400 });
    expect(await ask({ 'sec-websocket-key': key, 'sec-websocket-version': '7' })).toEqual({
      status: 400,
      version: '13, 8',
    });
    expect(
      await ask({
        'sec-websocket-key': key,
        'sec-websocket-version': '13',
        'sec-websocket-protocol': 'a, a',
      }),
    ).toEqual({ status: 400 });
    await vi.waitFor(() => {
      expect(onResponse).toHaveBeenCalledTimes(3);
    });
    expect(onResponse.mock.calls.map(([info]) => (info as { status: number }).status)).toEqual([
      400, 400, 400,
    ]);
  });

  it('sends the request id and hook headers with the 101', async () => {
    const url = await serve([echo], {
      onRequest: [
        (ctx) => {
          ctx.setHeader('x-hook', 'yes');
          ctx.setHeader('upgrade', 'nonsense');
        },
      ],
    });
    const { headers } = await open(`${url}/echo`);
    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers['x-hook']).toBe('yes');
    expect(headers['upgrade']).toBe('websocket');
  });

  describe('origins', () => {
    it('lets clients without an origin and pages from the same host connect', async () => {
      const url = await serve([echo]);
      await open(`${url}/echo`);
      const host = new URL(url).host;
      await open(`${url}/echo`, { origin: `http://${host}` });
    });

    it('refuses other origins with a 403', async () => {
      const url = await serve([echo]);
      expect(await connect(`${url}/echo`, { origin: 'https://evil.example' })).toEqual({
        status: 403,
      });
      expect(await connect(`${url}/echo`, { origin: 'null' })).toEqual({ status: 403 });
    });

    it('allows listed origins, any origin, or what a function says', async () => {
      const route = (origins: Parameters<typeof websocket>[2]) =>
        ({
          method: 'GET',
          path: '/',
          handler: (ctx: Context) => websocket(ctx, () => undefined, origins),
        }) satisfies Route;
      const listed = await serve([route({ origins: ['https://App.example/'] })]);
      await open(listed, { origin: 'https://app.example' });
      expect(await connect(listed, { origin: 'https://other.example' })).toEqual({ status: 403 });
      await app?.close();
      await open(await serve([route({ origins: '*' })]), { origin: 'https://any.example' });
      await app?.close();
      const fn = await serve([route({ origins: (origin) => origin.endsWith('.ok') })]);
      await open(fn, { origin: 'https://a.ok' });
      expect(await connect(fn, { origin: 'https://a.no' })).toEqual({ status: 403 });
    });
  });

  describe('message schema', () => {
    const Chat = v.object({ text: v.pipe(v.string(), v.maxLength(10)) });
    const chat: Route = {
      method: 'GET',
      path: '/',
      handler: (ctx) =>
        websocket(
          ctx,
          async (socket) => {
            for await (const message of socket) await socket.send(message.text.toUpperCase());
          },
          { message: Chat },
        ),
    };

    it('yields validated messages', async () => {
      const { ws } = await open(await serve([chat]));
      ws.send(JSON.stringify({ text: 'hi' }));
      expect(await next(ws)).toBe('HI');
    });

    it('closes with 1007 on bad JSON or a failed schema, 1003 on binary', async () => {
      const url = await serve([chat]);
      const cases: [string | Buffer, number][] = [
        ['not json', 1007],
        [JSON.stringify({ text: 'far too long here' }), 1007],
        [Buffer.from([1]), 1003],
      ];
      for (const [message, code] of cases) {
        const { ws } = await open(url);
        const end = closed(ws);
        ws.send(message);
        expect((await end).code).toBe(code);
      }
    });
  });

  it('closes with 1009 when a message is larger than maxPayload', async () => {
    const url = await serve([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) =>
          websocket(
            ctx,
            async (socket) => {
              for await (const message of socket) await socket.send(message);
            },
            { maxPayload: 8 },
          ),
      },
    ]);
    const { ws } = await open(url);
    const end = closed(ws);
    ws.send('123456789');
    expect((await end).code).toBe(1009);
  });

  it('closes with 1011 and logs when the handler throws', async () => {
    const log = logger();
    const url = await serve(
      [
        {
          method: 'GET',
          path: '/',
          handler: (ctx) =>
            websocket(ctx, async (socket) => {
              for await (const message of socket) throw new Error(`bad ${String(message)}`);
            }),
        },
      ],
      { logger: log },
    );
    const { ws } = await open(url);
    const end = closed(ws);
    ws.send('one');
    expect((await end).code).toBe(1011);
    expect(log.error).toHaveBeenCalledWith(
      'Upgrade handler failed: GET /',
      expect.objectContaining({ message: 'bad one' }),
      expect.anything(),
    );
  });

  it('says goodbye with 1001 on shutdown', async () => {
    const { ws } = await open(`${await serve([echo], { shutdownTimeout: 5_000 })}/echo`);
    const end = closed(ws);
    const started = Date.now();
    await app?.close();
    app = undefined;
    expect(await end).toEqual({ code: 1001, reason: 'Server shutting down' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('aborts socket.signal when the client leaves', async () => {
    let socket: WebSocketConnection | undefined;
    const url = await serve([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) =>
          websocket(ctx, (s) => {
            socket = s;
          }),
      },
    ]);
    const { ws } = await open(url);
    await vi.waitFor(() => {
      expect(socket).toBeDefined();
    });
    expect(socket?.signal.aborted).toBe(false);
    ws.close();
    await vi.waitFor(() => {
      expect(socket?.signal.aborted).toBe(true);
    });
    await socket?.send('ignored once closed');
  });

  it('drops a client that stops answering pings', async () => {
    const url = await serve([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) => websocket(ctx, () => undefined, { heartbeat: 40 }),
      },
    ]);
    const lively = await open(url);
    const silent = await open(url, { autoPong: false });
    const end = closed(silent.ws);
    expect((await end).code).toBe(1006);
    expect(lively.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('agrees on the preferred subprotocol', async () => {
    let protocol: string | undefined;
    const url = await serve([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) =>
          websocket(
            ctx,
            (socket) => {
              protocol = socket.protocol;
            },
            { protocols: ['chat.v2', 'chat.v1'] },
          ),
      },
    ]);
    const { ws } = await open(url, { protocols: ['chat.v1', 'chat.v2'] });
    expect(ws.protocol).toBe('chat.v2');
    await vi.waitFor(() => {
      expect(protocol).toBe('chat.v2');
    });
  });

  it('hands message events to socket.raw when it is read first', async () => {
    let iterate: (() => unknown) | undefined;
    const url = await serve([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) =>
          websocket(ctx, (socket) => {
            socket.raw.on('message', (data: Buffer) => {
              socket.raw.send(`raw ${data.toString()}`);
            });
            iterate = () => socket[Symbol.asyncIterator]();
          }),
      },
    ]);
    const { ws } = await open(url);
    ws.send('x');
    expect(await next(ws)).toBe('raw x');
    expect(iterate).toThrow('read through socket.raw');
  });

  it('rejects bad options when the route runs', async () => {
    const url = (
      await serve([
        {
          method: 'GET',
          path: '/',
          handler: (ctx) => websocket(ctx, () => undefined, { heartbeat: 0 }),
        },
      ])
    ).replace('ws:', 'http:');
    expect((await fetch(url)).status).toBe(500);
  });
});

describe('with modules, guards and pub/sub', () => {
  it('runs guards first and broadcasts through pub/sub', async () => {
    const Bus = definePubSub();
    type Bus = TokenType<typeof Bus>;
    const Said = defineChannel<{ room: string; text: string }>('said');

    @Injectable()
    class Rooms {
      static inject = [Bus] as const;
      constructor(private readonly bus: Bus) {}
      say(room: string, text: string) {
        return this.bus.publish(Said, { room, text });
      }
    }

    const signedIn = (ctx: Context) => {
      if (ctx.query.get('token') !== 'secret') throw new HttpError(401);
      return true;
    };

    @Controller('/rooms')
    class RoomsController {
      static inject = [Rooms, Bus] as const;
      constructor(
        private readonly rooms: Rooms,
        private readonly bus: Bus,
      ) {}

      @Get('/:room')
      @UseGuards(signedIn)
      join(ctx: Context<object, { room: string }>) {
        const room = ctx.params.room;
        return websocket(ctx, async (socket) => {
          const broadcast = async () => {
            for await (const event of this.bus.subscribe(Said, socket.signal)) {
              if (event.room === room) await socket.send(event.text);
            }
          };
          const listen = async () => {
            for await (const message of socket) await this.rooms.say(room, String(message));
          };
          await Promise.all([broadcast(), listen()]);
        });
      }
    }

    @Module({ imports: [Bus.module], controllers: [RoomsController], providers: [Rooms] })
    class AppModule {}

    app = createAvi({ logger: logger() }).register(AppModule);
    const { port } = await app.listen(0, '127.0.0.1');
    const base = `ws://127.0.0.1:${String(port)}/rooms`;

    expect(await connect(`${base}/a`)).toEqual({ status: 401 });
    const alice = (await open(`${base}/a?token=secret`)).ws;
    const bob = (await open(`${base}/a?token=secret`)).ws;
    const elsewhere = (await open(`${base}/b?token=secret`)).ws;
    const heard = vi.fn();
    elsewhere.on('message', heard);

    // Subscriptions start inside the handlers, just after open.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const bobHears = next(bob);
    const aliceHears = next(alice);
    alice.send('hello room');
    expect(await bobHears).toBe('hello room');
    expect(await aliceHears).toBe('hello room');
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('clients', () => {
  it("works with Node's built-in WebSocket and the test client", async () => {
    @Controller('/echo')
    class EchoController {
      @Get('/')
      connect(ctx: Context) {
        return websocket(ctx, async (socket) => {
          for await (const message of socket) await socket.send(`echo: ${String(message)}`);
        });
      }
    }
    const client = await createTestClient({ controllers: [EchoController] });
    try {
      const ws = new globalThis.WebSocket(`${client.url.replace('http', 'ws')}/echo`);
      const reply = new Promise((resolve) => {
        ws.onmessage = (e) => {
          resolve(e.data);
        };
      });
      ws.onopen = () => {
        ws.send('hi');
      };
      expect(await reply).toBe('echo: hi');
      ws.close();
    } finally {
      await client.close();
    }
  });

  it('rejects sending a value with no JSON form', async () => {
    let sent: Promise<void> | undefined;
    const url = await serve([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) =>
          websocket(ctx, (socket) => {
            sent = socket.send(undefined);
            sent.catch(() => undefined);
          }),
      },
    ]);
    await open(url);
    await vi.waitFor(() => {
      expect(sent).toBeDefined();
    });
    await expect(sent).rejects.toThrow('no JSON form');
  });
});
