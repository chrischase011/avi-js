// The operations behind reading a small JSON body, before and after the 0.4.0 change.
import { bench, do_not_optimize, group, run, summary } from 'mitata';

const chunk = Buffer.from(JSON.stringify({ name: 'Shiela', email: 'shiela@example.com', age: 36 }));

function isJsonBefore(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const end = contentType.indexOf(';');
  const mime = (end === -1 ? contentType : contentType.slice(0, end)).trim().toLowerCase();
  return mime === 'application/json' || (mime.startsWith('application/') && mime.endsWith('+json'));
}

function isJsonAfter(contentType: string | undefined): boolean {
  if (!contentType) return false;
  if (contentType === 'application/json') return true;
  return isJsonBefore(contentType);
}

group('one-chunk body', () => {
  summary(() => {
    bench('Buffer.concat (before)', () => {
      const chunks = [chunk];
      do_not_optimize(Buffer.concat(chunks, chunk.length));
    });
    bench('use the chunk (after)', () => {
      const chunks = [chunk];
      do_not_optimize(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, chunk.length));
    });
  });
});

group('content-type check', () => {
  summary(() => {
    bench('parse (before)', () => {
      do_not_optimize(isJsonBefore('application/json'));
    });
    bench('exact match first (after)', () => {
      do_not_optimize(isJsonAfter('application/json'));
    });
  });
});

class Ctx {
  #body: Promise<Buffer> | undefined;
  read = () => (this.#body ??= Promise.resolve(chunk));
  async text(): Promise<string> {
    return (await this.read()).toString('utf8');
  }
  async jsonBefore(): Promise<unknown> {
    return JSON.parse(await this.text()) as unknown;
  }
  async jsonAfter(): Promise<unknown> {
    return JSON.parse((await this.read()).toString('utf8')) as unknown;
  }
}

group('ctx.json()', () => {
  summary(() => {
    bench('through text() (before)', async () => {
      do_not_optimize(await new Ctx().jsonBefore());
    });
    bench('read directly (after)', async () => {
      do_not_optimize(await new Ctx().jsonAfter());
    });
  });
});

await run();
