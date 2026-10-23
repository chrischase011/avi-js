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
      'data: hello\n\n' +
        'event: progress\nid: 7\nretry: 2000\ndata: {"step":1}\n\n' +
        'data: line one\ndata: line two\ndata: line three\n\n',
    );
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
    expect(text).toMatch(/^(: ping\n\n)+data: done\n\n$/);
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
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n');
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

  it('validates the heartbeat option', () => {
    const ctx = {} as Parameters<typeof sse>[0];
    expect(() => sse(ctx, () => [], { heartbeat: 0 })).toThrow(RangeError);
    expect(() => sse(ctx, () => [], { heartbeat: 1.5 })).toThrow(RangeError);
  });
});
