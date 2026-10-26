import type { Context } from './context.js';
import { reply, type Reply } from './reply.js';

/** One server-sent event. A plain string is shorthand for `{ data }`. */
export interface ServerSentEvent {
  /** Strings are sent as is, anything else as JSON. Line breaks become several `data:` lines. */
  data?: unknown;
  event?: string;
  id?: string;
  /** How long the browser waits before reconnecting, in ms. */
  retry?: number;
}

export interface SseOptions {
  /** Sends a comment this often (ms) so proxies keep the connection open. Default 15 000. */
  heartbeat?: number | false;
}

export type SseSource = (
  signal: AbortSignal,
) => AsyncIterable<ServerSentEvent | string> | Iterable<ServerSentEvent | string>;

const encoder = new TextEncoder();
const HEARTBEAT = encoder.encode(': ping\n\n');

/**
 * Streams `source` as server-sent events. Events are produced only as fast as the client reads
 * them. `source` gets an abort signal for the client's disconnect; its `finally` blocks run when
 * the stream ends for any reason.
 */
export function sse(
  ctx: Context,
  source: SseSource,
  options: SseOptions = {},
): Reply<ReadableStream<Uint8Array>> {
  const heartbeat = options.heartbeat ?? 15_000;
  if (heartbeat !== false && (!Number.isInteger(heartbeat) || heartbeat <= 0)) {
    throw new RangeError(
      `sse heartbeat must be a positive integer or false, got ${String(heartbeat)}`,
    );
  }

  let iterator: AsyncIterator<ServerSentEvent | string> | Iterator<ServerSentEvent | string>;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    await iterator.return?.();
  };

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const iterable = source(ctx.signal);
        iterator =
          Symbol.asyncIterator in iterable
            ? iterable[Symbol.asyncIterator]()
            : iterable[Symbol.iterator]();
        if (heartbeat !== false) {
          timer = setInterval(() => {
            if (!closed) controller.enqueue(HEARTBEAT);
          }, heartbeat);
          timer.unref();
        }
      },
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (closed) return;
          if (next.done) {
            closed = true;
            clearInterval(timer);
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(format(next.value)));
        } catch (error) {
          await stop().catch(() => undefined);
          throw error;
        }
      },
      cancel: stop,
    },
    // Pull one event per read, so the source never runs ahead of the client.
    { highWaterMark: 0 },
  );

  return reply(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      // Stops nginx and similar proxies from buffering the stream.
      'x-accel-buffering': 'no',
    },
  });
}

function format(input: ServerSentEvent | string): string {
  const event = typeof input === 'string' ? { data: input } : input;
  let out = '';
  if (event.event !== undefined) out += `event: ${singleLine('event', event.event)}\n`;
  if (event.id !== undefined) out += `id: ${singleLine('id', event.id)}\n`;
  if (event.retry !== undefined) {
    // Safe integers only: larger ones print as 1e+21, which clients ignore.
    if (!Number.isSafeInteger(event.retry) || event.retry < 0) {
      throw new RangeError(`SSE retry must be a non-negative integer, got ${String(event.retry)}`);
    }
    out += `retry: ${String(event.retry)}\n`;
  }
  if (event.data !== undefined) {
    const text =
      typeof event.data === 'string'
        ? event.data
        : (JSON.stringify(event.data) as string | undefined);
    if (text === undefined) {
      throw new TypeError('SSE data must be a string or JSON-serializable');
    }
    for (const line of text.split(/\r\n|\r|\n/)) out += `data: ${line}\n`;
  }
  return `${out}\n`;
}

// A line break in an event name or id would start a new field the client did not send.
function singleLine(field: string, value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new TypeError(`SSE ${field} cannot contain line breaks or NUL`);
  }
  return value;
}
