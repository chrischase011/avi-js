import { afterEach, describe, expect, it } from 'vitest';
import { sse, type SseOptions, type SseSource } from '../src/index.js';
import { deferred, startServer, type TestServer } from './helpers.js';

let current: TestServer | undefined;

afterEach(async () => {
  await current?.server.close();
  current = undefined;
});

async function serve(source: SseSource, options?: SseOptions) {
  current = await startServer([
    { method: 'GET', path: '/events', handler: (ctx) => sse(ctx, source, options) },
  ]);
  return current;
}

/** Reads the whole response body as text. */
async function readAll(url: string): Promise<{ headers: Headers; text: string }> {
  const res = await fetch(url);
  return { headers: res.headers, text: await res.text() };
}

describe('sse', () => {
  it('frames events with the event-stream headers', async () => {
    const { url } = await serve(function* () {
      yield 'hello';
      yield { event: 'progress', id: '7', retry: 2000, data: { step: 1 } };
      yield { data: 'line one\nline two\r\nline three' };
    });

    const { headers, text } = await readAll(`${url}/events`);
    expect(headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(headers.get('cache-control')).toBe('no-cache');
    expect(headers.get('x-accel-buffering')).toBe('no');
    expect(text).toBe(
      ': open\n\n' +
        'data: hello\n\n' +
        'event: progress\nid: 7\nretry: 2000\ndata: {"step":1}\n\n' +
        'data: line one\ndata: line two\ndata: line three\n\n',
    );
  });

  it('sends the headers before the source has an event', async () => {
    const never = deferred();
    const { url } = await serve(async function* () {
      await never.promise;
      yield 'late';
    });

    const client = new AbortController();
    const res = await fetch(`${url}/events`, { signal: client.signal });
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    client.abort();
    never.resolve();
  });

  it('sends heartbeat comments while the source is idle', async () => {
    const { url } = await serve(
      async function* () {
        await new Promise((resolve) => setTimeout(resolve, 120));
        yield 'done';
      },
      { heartbeat: 30 },
    );

    const { text } = await readAll(`${url}/events`);
    expect(text).toMatch(/^: open\n\n(: ping\n\n)+data: done\n\n$/);
  });

  it('aborts the signal and runs finally when the client leaves', async () => {
    const cleaned = deferred();
    let aborted = false;
    const { url } = await serve(async function* (signal) {
      try {
        yield 'first';
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve();
          });
        });
      } finally {
        cleaned.resolve();
      }
    });

    const client = new AbortController();
    const res = await fetch(`${url}/events`, { signal: client.signal });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    let text = '';
    while (!text.includes('data: first')) {
      text += new TextDecoder().decode((await reader.read()).value);
    }
    expect(text).toBe(': open\n\ndata: first\n\n');
    client.abort();

    await cleaned.promise;
    expect(aborted).toBe(true);
  });

  it('does not run the source ahead of a slow client', async () => {
    let produced = 0;
    const chunk = 'x'.repeat(256 * 1024);
    const { url } = await serve(function* () {
      for (;;) {
        produced++;
        yield chunk;
      }
    });

    const client = new AbortController();
    const res = await fetch(`${url}/events`, { signal: client.signal });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Socket and stream buffers hold a few events; an unbounded producer would be in the thousands.
    expect(produced).toBeLessThan(40);
    client.abort();
  });

  it('ends the stream and logs when the source throws', async () => {
    const server = await serve(function* () {
      yield 'before';
      throw new Error('feed broke');
    });

    await expect(readAll(`${server.url}/events`)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.logger.error).toHaveBeenCalledWith(
      'Response stream failed: GET /events',
      expect.objectContaining({ message: 'feed broke' }),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('refuses event names and ids that would start a new field', async () => {
    const server = await serve(function* () {
      yield { event: 'ok\ndata: injected', data: 'x' };
    });

    await expect(readAll(`${server.url}/events`)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.logger.error).toHaveBeenCalledWith(
      'Response stream failed: GET /events',
      expect.objectContaining({ message: 'SSE event cannot contain line breaks or NUL' }),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('names the problem when data cannot be sent, or retry is too large', async () => {
    for (const [event, message] of [
      [{ data: Symbol('x') }, 'SSE data must be a string or JSON-serializable'],
      [{ data: 'x', retry: 1e21 }, 'SSE retry must be a non-negative integer'],
    ] as const) {
      const server = await serve(function* () {
        yield event;
      });
      await expect(readAll(`${server.url}/events`)).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(server.logger.error).toHaveBeenCalledWith(
        'Response stream failed: GET /events',
        expect.objectContaining({ message: expect.stringContaining(message) as unknown }),
        expect.anything(),
      );
      await current?.server.close();
    }
  });

  it('ends open streams when the server closes, even if the source ignores the signal', async () => {
    const never = deferred();
    let finished = false;
    const server = await serve(async function* () {
      try {
        yield 'first';
        await never.promise;
      } finally {
        finished = true;
      }
    });
    const res = await fetch(`${server.url}/events`);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('data: first')) {
      text += decoder.decode((await reader.read()).value);
    }

    const started = performance.now();
    await server.server.close();
    expect(performance.now() - started).toBeLessThan(2000);
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      text += decoder.decode(chunk.value);
    }
    expect(text).toBe(': open\n\ndata: first\n\n');
    never.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(finished).toBe(true);
    current = undefined;
  });

  it('validates the heartbeat option', () => {
    const ctx = {} as Parameters<typeof sse>[0];
    expect(() => sse(ctx, () => [], { heartbeat: 0 })).toThrow(RangeError);
    expect(() => sse(ctx, () => [], { heartbeat: 1.5 })).toThrow(RangeError);
  });
  it('stops the source when the client left before sse() was called', async () => {
    const left = deferred();
    const stopped = deferred();
    let heartbeats = 0;
    current = await startServer([
      {
        method: 'GET',
        path: '/events',
        handler: async (ctx) => {
          await left.promise;
          const source: AsyncIterableIterator<string> = {
            next: () => new Promise(() => undefined),
            return: () => {
              stopped.resolve();
              return Promise.resolve({ value: undefined, done: true });
            },
            [Symbol.asyncIterator]: () => source,
          };
          return sse(ctx, () => source, { heartbeat: 5 });
        },
      },
    ]);
    const client = new AbortController();
    const res = fetch(`${current.url}/events`, { signal: client.signal }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    client.abort();
    await res;
    await new Promise((resolve) => setTimeout(resolve, 20));
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with its own this
    const enqueue = ReadableStreamDefaultController.prototype.enqueue;
    ReadableStreamDefaultController.prototype.enqueue = function (this: never, chunk: never) {
      heartbeats++;
      enqueue.call(this, chunk);
    };
    try {
      left.resolve();
      await stopped.promise;
      await new Promise((resolve) => setTimeout(resolve, 30));
      // The opening comment only; no heartbeats.
      expect(heartbeats).toBeLessThanOrEqual(1);
    } finally {
      ReadableStreamDefaultController.prototype.enqueue = enqueue;
    }
  });
});
