import {
  HttpError,
  upgrade,
  type Context,
  type InferOutput,
  type StandardSchemaV1,
  type Upgrade,
  type UpgradeConnection,
} from '@avijs/core';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

/** A message as received: text frames as strings, binary frames as bytes. */
export type WebSocketMessage = string | Uint8Array;

/** What iterating a connection gives: validated JSON with a `message` schema, else raw messages. */
export type MessageOf<S> = S extends StandardSchemaV1 ? InferOutput<S> : WebSocketMessage;

export interface WebSocketOptions<S extends StandardSchemaV1 | undefined = undefined> {
  /**
   * Parses each message as JSON and validates it. A message that is not JSON or fails the schema
   * closes the connection with code 1007; a binary one with 1003.
   */
  message?: S;
  /** The largest message accepted, in bytes. Larger ones close the connection (1009). Default 1 MiB. */
  maxPayload?: number;
  /** Pings this often, in ms, and drops a client that missed the previous ping. Default 30 000. */
  heartbeat?: number | false;
  /**
   * Origins allowed to connect from a browser, such as `https://app.example.com`. Default: only
   * pages served from the same host. `'*'` allows any, or pass a function. Clients that send no
   * `Origin` (not browsers) are always allowed.
   */
  origins?: readonly string[] | '*' | ((origin: string) => boolean);
  /** Subprotocols the server speaks, in order of preference. Default: accept the client's first. */
  protocols?: readonly string[];
}

/** One client connection. Iterate it for the client's messages. */
export interface WebSocketConnection<T = WebSocketMessage> extends AsyncIterable<T> {
  /** Aborts when the connection closes, for either side's reason. */
  readonly signal: AbortSignal;
  /** The subprotocol agreed on, or `''`. */
  readonly protocol: string;
  /**
   * Sends strings as text, bytes as binary and anything else as JSON. Resolves once written, so
   * awaiting it keeps a slow client from piling up messages. Does nothing once closed.
   */
  send(data: unknown): Promise<void>;
  /** Starts the closing handshake. Default code 1000. */
  close(code?: number, reason?: string): void;
  /**
   * The `ws` socket underneath, for what this interface lacks. Not covered by the stability
   * promise. Reading it before iterating hands message events over to it: iterating then throws.
   */
  readonly raw: WebSocket;
}

export type WebSocketHandler<T> = (socket: WebSocketConnection<T>) => unknown;

const MAX_PAYLOAD = 1024 * 1024;
const HEARTBEAT = 30_000;
// Messages read ahead of the handler before the socket stops reading.
const QUEUE = 16;
// Headers ws writes itself; one set by a hook would make a broken 101.
const OWN_HEADERS = new Set([
  'connection',
  'upgrade',
  'sec-websocket-accept',
  'sec-websocket-protocol',
]);

/**
 * Accepts a WebSocket connection on this route. Return the result from the handler: guards,
 * middleware and validation run first, and `handler` gets the connection once it is open.
 * Plain requests get a 426. The connection stays open until either side closes it; an error
 * thrown by `handler` closes it with 1011 and is logged.
 */
export function websocket<S extends StandardSchemaV1 | undefined = undefined>(
  ctx: Context,
  handler: WebSocketHandler<MessageOf<S>>,
  options: WebSocketOptions<S> = {},
): Upgrade {
  const maxPayload = options.maxPayload ?? MAX_PAYLOAD;
  if (!Number.isInteger(maxPayload) || maxPayload <= 0) {
    throw new RangeError(
      `websocket maxPayload must be a positive integer, got ${String(maxPayload)}`,
    );
  }
  const heartbeat = options.heartbeat ?? HEARTBEAT;
  if (heartbeat !== false && (!Number.isInteger(heartbeat) || heartbeat <= 0)) {
    throw new RangeError(
      `websocket heartbeat must be a positive integer or false, got ${String(heartbeat)}`,
    );
  }
  const accepted = upgrade(
    ctx,
    (connection) => open(connection, handler, options, maxPayload, heartbeat),
    {
      protocol: 'websocket',
    },
  );
  checkHandshake(ctx);
  const origin = ctx.headers.origin;
  if (origin !== undefined && !originAllowed(origin, ctx.headers.host, options.origins)) {
    throw new HttpError(403, 'This origin may not connect');
  }
  return accepted;
}

const KEY = /^[+/0-9A-Za-z]{22}==$/;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** The checks `ws` makes, done here so a refusal is an ordinary error response. */
function checkHandshake(ctx: Context): void {
  if (ctx.method !== 'GET') throw new HttpError(405, 'A WebSocket handshake must be a GET');
  const key = ctx.headers['sec-websocket-key'];
  if (key === undefined || !KEY.test(key)) {
    throw new HttpError(400, 'Missing or invalid Sec-WebSocket-Key header');
  }
  const version = ctx.headers['sec-websocket-version'];
  if (version !== '13' && version !== '8') {
    throw new HttpError(400, 'Missing or invalid Sec-WebSocket-Version header', {
      headers: { 'sec-websocket-version': '13, 8' },
    });
  }
  const protocols = ctx.headers['sec-websocket-protocol'];
  if (protocols !== undefined) {
    const names = protocols.split(',').map((name) => name.trim());
    if (names.some((name) => !TOKEN.test(name)) || new Set(names).size !== names.length) {
      throw new HttpError(400, 'Invalid Sec-WebSocket-Protocol header');
    }
  }
}

function originAllowed(
  origin: string,
  host: string | undefined,
  allowed: WebSocketOptions['origins'],
): boolean {
  if (allowed === '*') return true;
  if (typeof allowed === 'function') return allowed(origin);
  const normalized = origin.toLowerCase();
  if (allowed)
    return allowed.some((entry) => entry.toLowerCase().replace(/\/$/, '') === normalized);
  try {
    return new URL(origin).host === host?.toLowerCase();
  } catch {
    return false;
  }
}

function open<S extends StandardSchemaV1 | undefined>(
  { req, socket, head, signal, headers }: UpgradeConnection,
  handler: WebSocketHandler<MessageOf<S>>,
  options: WebSocketOptions<S>,
  maxPayload: number,
  heartbeat: number | false,
): Promise<void> {
  const protocols = options.protocols;
  const server = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload,
    ...(protocols && {
      handleProtocols: (offered: Set<string>) =>
        protocols.find((name) => offered.has(name)) ?? false,
    }),
  });
  server.once('headers', (lines: string[]) => {
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined || OWN_HEADERS.has(name)) continue;
      for (const item of Array.isArray(value) ? value : [value])
        lines.push(`${name}: ${String(item)}`);
    }
  });

  return new Promise((resolve, reject) => {
    server.handleUpgrade(req, socket, head, (ws) => {
      const connection = new Connection<MessageOf<S>>(ws, options.message, heartbeat);
      const shutdown = () => {
        ws.close(1001, 'Server shutting down');
      };
      if (signal.aborted) shutdown();
      else signal.addEventListener('abort', shutdown, { once: true });
      connection.signal.addEventListener('abort', () => {
        signal.removeEventListener('abort', shutdown);
      });
      const fail = (error: unknown) => {
        if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Internal error');
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      try {
        Promise.resolve(handler(connection)).then(() => {
          resolve();
        }, fail);
      } catch (error) {
        fail(error);
      }
    });
  });
}

class Connection<T> implements WebSocketConnection<T> {
  readonly #ws: WebSocket;
  readonly #schema: StandardSchemaV1 | undefined;
  readonly #closed = new AbortController();
  readonly #queue: T[] = [];
  #waiting: ((result: IteratorResult<T>) => void) | undefined;
  #iterating = false;
  #detached = false;
  #paused = false;
  #alive = true;
  // Validation can be async; this keeps messages in order.
  #chain: Promise<void> = Promise.resolve();
  // Messages still being validated, counted with the queue.
  #validating = 0;

  constructor(ws: WebSocket, schema: StandardSchemaV1 | undefined, heartbeat: number | false) {
    this.#ws = ws;
    this.#schema = schema;
    const onMessage = (data: RawData, binary: boolean) => {
      this.#receive(data, binary);
    };
    ws.on('message', onMessage);
    ws.on('error', () => undefined);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (heartbeat !== false) {
      ws.on('pong', () => (this.#alive = true));
      timer = setInterval(() => {
        // A paused socket reads no pongs; the client is not to blame for that.
        if (this.#paused) return;
        if (!this.#alive) {
          ws.terminate();
          return;
        }
        this.#alive = false;
        ws.ping();
      }, heartbeat);
      timer.unref();
    }
    ws.once('close', () => {
      clearInterval(timer);
      ws.off('message', onMessage);
      this.#closed.abort();
      this.#waiting?.({ done: true, value: undefined });
      this.#waiting = undefined;
    });
  }

  get signal(): AbortSignal {
    return this.#closed.signal;
  }

  get protocol(): string {
    return this.#ws.protocol;
  }

  get raw(): WebSocket {
    if (!this.#iterating) {
      this.#detached = true;
      this.#queue.length = 0;
      this.#resume();
    }
    return this.#ws;
  }

  send(data: unknown): Promise<void> {
    const ws = this.#ws;
    if (ws.readyState !== WebSocket.OPEN) return Promise.resolve();
    const binary = data instanceof Uint8Array || data instanceof ArrayBuffer;
    // JSON.stringify gives undefined for functions and undefined itself.
    const payload =
      binary || typeof data === 'string' ? data : (JSON.stringify(data) as string | undefined);
    if (payload === undefined) {
      return Promise.reject(new TypeError('websocket send: this value has no JSON form'));
    }
    return new Promise((resolve, reject) => {
      ws.send(payload, { binary }, (error) => {
        // A client that left mid-send is not the sender's error.
        if (error && ws.readyState === WebSocket.OPEN) reject(error);
        else resolve();
      });
    });
  }

  close(code = 1000, reason?: string): void {
    this.#ws.close(code, reason);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.#detached) {
      throw new Error('This connection is read through socket.raw; it cannot be iterated too');
    }
    if (this.#iterating) throw new Error('A connection can be iterated only once');
    this.#iterating = true;
    return {
      next: () => {
        if (this.#queue.length > 0) {
          const value = this.#queue.shift() as T;
          if (this.#queue.length < QUEUE / 2) this.#resume();
          return Promise.resolve({ done: false, value });
        }
        if (this.#closed.signal.aborted || this.#detached) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise((resolve) => (this.#waiting = resolve));
      },
      // Breaking out of the loop stops reading; the connection stays open until closed.
      return: () => {
        this.#detached = true;
        this.#queue.length = 0;
        this.#resume();
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  }

  #receive(data: RawData, binary: boolean): void {
    if (this.#detached) return;
    const bytes = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data);
    const schema = this.#schema;
    if (!schema) {
      this.#push((binary ? bytes : bytes.toString('utf8')) as T);
      return;
    }
    if (binary) {
      this.close(1003, 'Binary messages are not accepted');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      this.close(1007, 'Invalid JSON');
      return;
    }
    if (this.#full()) return;
    this.#validating++;
    this.#chain = this.#chain
      .then(async () => {
        const result = await schema['~standard'].validate(parsed);
        this.#validating--;
        if (result.issues) this.close(1007, 'Invalid message');
        else this.#push(result.value as T);
      })
      .catch(() => {
        this.close(1011, 'Internal error');
      });
    this.#pauseIfFull();
  }

  #push(value: T): void {
    if (this.#detached || this.#ws.readyState !== WebSocket.OPEN) return;
    const waiting = this.#waiting;
    if (waiting) {
      this.#waiting = undefined;
      waiting({ done: false, value });
      return;
    }
    if (!this.#iterating && this.#queue.length >= QUEUE) return;
    this.#queue.push(value);
    this.#pauseIfFull();
  }

  /** Until the handler iterates, messages past the read-ahead are dropped instead of waiting. */
  #full(): boolean {
    return !this.#iterating && this.#queue.length + this.#validating >= QUEUE;
  }

  // Only a handler that is reading gets to hold the socket back.
  #pauseIfFull(): void {
    if (!this.#iterating || this.#paused) return;
    if (this.#queue.length + this.#validating < QUEUE) return;
    this.#paused = true;
    this.#ws.pause();
  }

  #resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    // Pongs that arrived while paused are only read now.
    this.#alive = true;
    this.#ws.resume();
  }
}
