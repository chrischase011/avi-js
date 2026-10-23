import { HttpServer, Router, type Handler } from '@avijs/http';
import fc from 'fast-check';
import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { multipart, readForm, type ReadFormOptions } from '../src/index.js';

let server: HttpServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function serve(handler: Handler, logger = { error: vi.fn() }) {
  const router = new Router();
  router.add([{ method: 'POST', path: '/', handler }]);
  server = new HttpServer(router, { logger });
  const { port } = await server.listen(0, '127.0.0.1');
  return { url: `http://127.0.0.1:${String(port)}`, port, logger };
}

const formServer = (options?: ReadFormOptions) =>
  serve(async (ctx) => {
    const { fields, files } = await readForm(ctx, options);
    return {
      fields: { ...fields },
      files: files.map(({ name, filename, mimeType, size, buffer }) => ({
        name,
        filename,
        mimeType,
        size,
        text: buffer.toString('utf8'),
      })),
    };
  });

function form(entries: [string, string | Blob, string?][]): FormData {
  const data = new FormData();
  for (const [name, value, filename] of entries) {
    if (typeof value === 'string') data.append(name, value);
    else data.append(name, value, filename);
  }
  return data;
}

async function post(url: string, body: FormData | string, contentType?: string) {
  const res = await fetch(url, {
    method: 'POST',
    body,
    ...(contentType ? { headers: { 'content-type': contentType } } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const file = (text: string, type = 'text/plain') => new Blob([text], { type });

describe('readForm', () => {
  it('reads fields, repeated fields and files', async () => {
    const { url } = await formServer();
    const res = await post(
      url,
      form([
        ['title', 'Holiday'],
        ['tag', 'sea'],
        ['tag', 'sun'],
        ['photo', file('JPEGDATA', 'image/jpeg'), 'beach.jpg'],
      ]),
    );
    expect(res).toEqual({
      status: 200,
      body: {
        fields: { title: 'Holiday', tag: ['sea', 'sun'] },
        files: [
          {
            name: 'photo',
            filename: 'beach.jpg',
            mimeType: 'image/jpeg',
            size: 8,
            text: 'JPEGDATA',
          },
        ],
      },
    });
  });

  it('keeps fields named like Object properties as plain fields', async () => {
    const { url } = await formServer();
    const res = await post(
      url,
      form([
        ['__proto__', 'x'],
        ['constructor', 'y'],
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.body['fields']).toEqual({ ['__proto__']: 'x', constructor: 'y' });
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('drops directories from file names', async () => {
    const { url } = await formServer();
    const res = await post(url, form([['f', file('x'), '../../etc/passwd']]));
    expect((res.body['files'] as { filename: string }[])[0]?.filename).toBe('passwd');
  });

  it.each<[string, ReadFormOptions, [string, string | Blob, string?][], RegExp]>([
    ['a file over fileSize', { fileSize: 4 }, [['f', file('12345'), 'a.txt']], /File f is larger/],
    [
      'too many files',
      { files: 1 },
      [
        ['a', file('1'), 'a'],
        ['b', file('2'), 'b'],
      ],
      /More than 1 files/,
    ],
    [
      'too many fields',
      { fields: 1 },
      [
        ['a', '1'],
        ['b', '2'],
      ],
      /More than 1 fields/,
    ],
    ['a field over fieldSize', { fieldSize: 3 }, [['a', '1234']], /Field a is larger/],
    [
      'too many parts',
      { parts: 1 },
      [
        ['a', '1'],
        ['b', file('2'), 'b'],
      ],
      /More than 1 parts/,
    ],
    [
      'a form over maxTotalSize',
      { maxTotalSize: 5 },
      [
        ['a', '123'],
        ['b', file('456'), 'b'],
      ],
      /Form is larger/,
    ],
  ])('answers 413 for %s', async (_label, options, entries, message) => {
    const { url } = await formServer(options);
    const res = await post(url, form(entries));
    expect(res.status).toBe(413);
    expect(res.body['message']).toMatch(message);
  });

  // Found by the fuzz test in CI: the parser read these bodies and then went silent.
  it.each(['--b"\r\n--b--', '--b"', '--bx\r\n\r\n--b--'])(
    'answers 400 instead of hanging on %j',
    async (body) => {
      const { url } = await formServer();
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: { 'content-type': 'multipart/form-data; boundary=b' },
        signal: AbortSignal.timeout(2000),
      });
      expect(res.status).toBe(400);
    },
  );

  it('answers 400, not 500, when a file part breaks off', async () => {
    const { url, logger } = await formServer();
    const body = [
      '--bContent-Disposition: form-data; name="a"; filename="f"',
      '',
      'Content-Disposition: form-data; name="a"',
    ].join(String.fromCharCode(13, 10));
    expect((await post(url, body, 'multipart/form-data; boundary=b')).status).toBe(400);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers 415 for another content type and 400 for a malformed body', async () => {
    const { url } = await formServer();
    expect((await post(url, 'a=1', 'application/x-www-form-urlencoded')).status).toBe(415);
    expect((await post(url, 'x', 'multipart/form-data; foo=bar')).status).toBe(400);
    const truncated = '--b\r\nContent-Disposition: form-data; name="a"\r\n\r\nvalue';
    expect((await post(url, truncated, 'multipart/form-data; boundary=b')).status).toBe(400);
  });

  it('validates its options', async () => {
    const { url } = await serve((ctx) => readForm(ctx, { files: 0 }));
    expect((await post(url, form([['a', '1']]))).status).toBe(500);
  });
});

describe('multipart', () => {
  it('streams parts in order and discards files the caller skips', async () => {
    const { url } = await serve(async (ctx) => {
      const seen: string[] = [];
      for await (const part of multipart(ctx)) {
        seen.push(part.kind === 'file' ? `file:${part.filename}` : `field:${part.value}`);
      }
      return seen;
    });
    const big = 'x'.repeat(1024 * 1024);
    const res = await post(
      url,
      form([
        ['a', file(big), 'one.bin'],
        ['b', 'between'],
        ['c', file(big), 'two.bin'],
      ]),
    );
    expect(res).toEqual({
      status: 200,
      body: ['file:one.bin', 'field:between', 'file:two.bin'] as unknown as Record<string, unknown>,
    });
  });

  it('lets the caller stop early', async () => {
    const { url } = await serve(async (ctx) => {
      for await (const part of multipart(ctx)) return { first: part.name };
      return {};
    });
    const res = await post(
      url,
      form([
        ['a', '1'],
        ['b', file('2'), 'b'],
      ]),
    );
    expect(res).toEqual({ status: 200, body: { first: 'a' } });
  });

  it('refuses a body that was already read', async () => {
    const { url, logger } = await serve(async (ctx) => {
      await ctx.text().catch(() => undefined);
      for await (const part of multipart(ctx)) return part.name;
      return null;
    });
    expect((await post(url, form([['a', '1']]))).status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      'Request failed: POST /',
      expect.objectContaining({ message: expect.stringContaining('already read') as unknown }),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('stops cleanly when the client disconnects mid-upload', async () => {
    let outcome: string | undefined;
    const { port } = await serve(async (ctx) => {
      try {
        for await (const part of multipart(ctx)) {
          if (part.kind === 'file') await part.stream.toArray();
        }
        outcome = 'finished';
      } catch (error) {
        outcome = (error as Error).message;
        throw error;
      }
      return 'ok';
    });

    const req = request({
      port,
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=b' },
    });
    req.on('error', () => undefined);
    req.write('--b\r\nContent-Disposition: form-data; name="f"; filename="a"\r\n\r\npartial data');
    await new Promise((resolve) => setTimeout(resolve, 50));
    req.destroy();

    await vi.waitFor(() => {
      expect(outcome).toBeDefined();
    });
    expect(outcome).not.toBe('finished');
  });

  it('never fails with a 500 or hangs on arbitrary bodies', async () => {
    const { url, logger } = await serve(async (ctx) => {
      const form = await readForm(ctx, { fileSize: 1024, maxTotalSize: 4096 });
      return { fields: Object.keys(form.fields).length, files: form.files.length };
    });
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string({ maxLength: 300 }),
          fc
            .array(
              fc.constantFrom(
                '--b',
                '\r\n',
                'Content-Disposition: form-data; name="a"',
                '; filename="f"',
                'x',
                '--b--',
                '"',
              ),
              { maxLength: 30 },
            )
            .map((pieces) => pieces.join('')),
        ),
        async (body) => {
          const res = await fetch(url, {
            method: 'POST',
            body,
            headers: { 'content-type': 'multipart/form-data; boundary=b' },
            signal: AbortSignal.timeout(2000),
          });
          await res.arrayBuffer();
          expect(res.status).toBeLessThan(500);
        },
      ),
      // FUZZ_RUNS=5000 pnpm test packages/multipart for a longer search.
      { numRuns: Number(process.env['FUZZ_RUNS'] ?? 100) },
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
