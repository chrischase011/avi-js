import { HttpError, type Context } from '@avijs/http';
import { Busboy, type BusboyHeaders, type BusboyInstance } from '@fastify/busboy';
import { PassThrough, type Readable } from 'node:stream';

export interface MultipartLimits {
  /** Largest file, in bytes. Default: 10 MiB. */
  fileSize?: number;
  /** Most files. Default: 10. */
  files?: number;
  /** Most text fields. Default: 100. */
  fields?: number;
  /** Largest text field, in bytes. Default: 100 KiB. */
  fieldSize?: number;
  /** Most parts, files and fields together. Default: 1000. */
  parts?: number;
}

export interface MultipartOptions extends MultipartLimits {
  /**
   * File types to accept, such as `image/png` or `image/*`. A file of another type gets `415`
   * before it is read. This checks the type the client claims; check the bytes too when it matters.
   */
  accept?: readonly string[];
}

export interface FieldPart {
  readonly kind: 'field';
  readonly name: string;
  readonly value: string;
}

export interface FilePart {
  readonly kind: 'file';
  readonly name: string;
  /** The client's file name, without directories. Untrusted: never use it as a path. */
  readonly filename: string;
  /** The type the client claims. Untrusted. */
  readonly mimeType: string;
  /** The file's bytes. Read or pipe it before asking for the next part. */
  readonly stream: Readable;
  /** Bytes received so far: the file's size once `stream` has ended. */
  readonly size: number;
}

export type Part = FieldPart | FilePart;

const MiB = 1024 * 1024;
const DEFAULTS: Required<MultipartLimits> = {
  fileSize: 10 * MiB,
  files: 10,
  fields: 100,
  fieldSize: 100 * 1024,
  parts: 1000,
};

/**
 * Reads a `multipart/form-data` body part by part, without buffering files. Limits are enforced
 * while reading: `413` as soon as one is exceeded, `400` for a malformed body, `415` for another
 * content type or a file type `accept` does not list.
 */
export async function* multipart(
  ctx: Context,
  options: MultipartOptions = {},
): AsyncGenerator<Part> {
  const max = resolveLimits(options);
  const accepts = acceptor(options.accept);
  const type = ctx.headers['content-type'];
  if (!type || !/^multipart\/form-data\s*;/i.test(type)) {
    throw new HttpError(415, 'Expected a multipart/form-data body');
  }
  const req = ctx.req;
  if (req.readableEnded || req.readableFlowing !== null) {
    throw new Error(
      'The request body was already read; use either ctx.json()/ctx.text() or multipart()',
    );
  }

  let busboy: BusboyInstance;
  try {
    busboy = Busboy({ headers: req.headers as BusboyHeaders, limits: max });
  } catch (error) {
    throw new HttpError(400, 'Malformed multipart body', { cause: error });
  }

  const queue: Part[] = [];
  const open = new Set<Readable>();
  // Changed from event callbacks, so kept in an object the type checker does not narrow.
  const state: { failure: Error | undefined; finished: boolean } = {
    failure: undefined,
    finished: false,
  };
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const stopReading = () => {
    req.unpipe(busboy);
    ctx.signal.removeEventListener('abort', onAbort);
  };
  const fail = (error: Error) => {
    if (state.failure) return;
    state.failure = error;
    stopReading();
    for (const stream of open) stream.destroy(error);
    notify();
  };
  const onAbort = () => {
    fail(new HttpError(400, 'Request aborted'));
  };

  busboy.on('file', (name, source, filename, _encoding, mimeType) => {
    if (accepts && !accepts(mimeType)) {
      source.resume();
      fail(
        new HttpError(
          415,
          `File ${JSON.stringify(name)} has type ${mimeType || '(none)'}; expected ${(options.accept ?? []).join(', ')}`,
        ),
      );
      return;
    }
    // Callers get our own stream, so every failure reaches them as an HttpError (400 or 413)
    // rather than the parser's plain errors, which would become 500s.
    const stream = new PassThrough();
    // fail() destroys open streams with the error. A stream the caller has not taken yet has no
    // other listener, and an unhandled stream error would crash the process.
    stream.on('error', ignore);
    source.on('error', (error: unknown) => {
      stream.destroy(
        error instanceof HttpError
          ? error
          : (state.failure ?? new HttpError(400, 'Malformed multipart body', { cause: error })),
      );
    });
    // If the caller abandons the stream, drain the rest so the parser can move on.
    stream.once('close', () => {
      if (!source.readableEnded) source.resume();
    });
    source.pipe(stream);
    open.add(source);
    source.once('end', () => {
      open.delete(source);
      notify();
    });
    source.once('limit', () => {
      fail(tooLarge(`File ${JSON.stringify(name)} is larger than ${String(max.fileSize)} bytes`));
    });
    let size = 0;
    source.on('data', (chunk: Buffer) => {
      size += chunk.length;
    });
    queue.push({
      kind: 'file',
      name,
      filename,
      mimeType,
      stream,
      get size() {
        return size;
      },
    });
    notify();
  });
  busboy.on('field', (name, value, _nameTruncated, valueTruncated) => {
    if (valueTruncated) {
      fail(tooLarge(`Field ${JSON.stringify(name)} is larger than ${String(max.fieldSize)} bytes`));
      return;
    }
    queue.push({ kind: 'field', name, value });
    notify();
  });
  busboy.on('filesLimit', () => {
    fail(tooLarge(`More than ${String(max.files)} files`));
  });
  busboy.on('fieldsLimit', () => {
    fail(tooLarge(`More than ${String(max.fields)} fields`));
  });
  busboy.on('partsLimit', () => {
    fail(tooLarge(`More than ${String(max.parts)} parts`));
  });
  busboy.on('error', (error: unknown) => {
    fail(new HttpError(400, 'Malformed multipart body', { cause: error }));
  });
  busboy.on('finish', () => {
    state.finished = true;
    notify();
  });
  ctx.signal.addEventListener('abort', onAbort);
  // Busboy can read some malformed bodies to the end and then emit neither 'finish' nor 'error'.
  // Once the body has arrived and every part is done, a parser that has not finished is stuck.
  const stalled = () =>
    received && queue.length === 0 && open.size === 0 && busboy.writableFinished;
  let received = false;
  req.once('end', () => {
    received = true;
    setImmediate(notify);
  });
  req.pipe(busboy);

  let previous: FilePart | undefined;
  let suspect = false;
  try {
    for (;;) {
      // A file the caller skipped would stall the parser; discard what it did not read.
      if (previous?.stream.readableFlowing === null) previous.stream.resume();
      previous = undefined;
      if (state.failure) throw state.failure;
      const part = queue.shift();
      if (part) {
        if (part.kind === 'file') previous = part;
        yield part;
        continue;
      }
      if (state.finished) return;
      if (stalled()) {
        // A 'finish' already on its way gets one more turn of the event loop; stalled twice in
        // a row means the parser is stuck.
        if (suspect) fail(new HttpError(400, 'Malformed multipart body'));
        else await new Promise((resolve) => setImmediate(resolve));
        suspect = true;
        continue;
      }
      suspect = false;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    if (!state.finished) stopReading();
    ctx.signal.removeEventListener('abort', onAbort);
  }
}

export interface UploadedFile {
  readonly name: string;
  /** The client's file name, without directories. Untrusted: never use it as a path. */
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export interface ReadFormOptions extends MultipartOptions {
  /** Most bytes buffered across all files and fields. Default: 10 MiB. */
  maxTotalSize?: number;
}

export interface Form {
  /** Text fields; a name sent more than once has all its values, in order. */
  readonly fields: Readonly<Record<string, string | string[]>>;
  readonly files: readonly UploadedFile[];
}

/** Reads a whole form into memory, for small uploads. Use `multipart()` to stream large files. */
export async function readForm(ctx: Context, options: ReadFormOptions = {}): Promise<Form> {
  const maxTotal = positive('maxTotalSize', options.maxTotalSize ?? 10 * MiB);
  // No prototype, so a field named __proto__ or constructor is just a field.
  const fields = Object.create(null) as Record<string, string | string[]>;
  const files: UploadedFile[] = [];
  let total = 0;
  const count = (bytes: number) => {
    total += bytes;
    if (total > maxTotal) throw tooLarge(`Form is larger than ${String(maxTotal)} bytes`);
  };

  for await (const part of multipart(ctx, options)) {
    if (part.kind === 'field') {
      count(Buffer.byteLength(part.value));
      const existing = fields[part.name];
      fields[part.name] =
        existing === undefined
          ? part.value
          : Array.isArray(existing)
            ? [...existing, part.value]
            : [existing, part.value];
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.stream as AsyncIterable<Buffer>) {
      count(chunk.length);
      size += chunk.length;
      chunks.push(chunk);
    }
    const { name, filename, mimeType } = part;
    files.push({ name, filename, mimeType, size, buffer: Buffer.concat(chunks, size) });
  }
  return { fields, files };
}

function resolveLimits(limits: MultipartLimits): Required<MultipartLimits> {
  const resolved = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof MultipartLimits)[]) {
    const value = limits[key];
    if (value !== undefined) resolved[key] = positive(key, value);
  }
  return resolved;
}

/** A matcher for `accept`: exact types and `type/*`, ignoring case and parameters. */
function acceptor(
  accept: readonly string[] | undefined,
): ((mimeType: string) => boolean) | undefined {
  if (accept === undefined) return undefined;
  if (!Array.isArray(accept) || accept.length === 0) {
    throw new RangeError('multipart: accept must list at least one type, such as image/png');
  }
  const exact = new Set<string>();
  const families = new Set<string>();
  for (const entry of accept as readonly unknown[]) {
    const type = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
    const match = /^([a-z0-9][\w.+-]*)\/([a-z0-9][\w.+-]*|\*)$/.exec(type);
    if (!match) {
      throw new RangeError(
        `multipart: accept entries look like image/png or image/*, got ${String(entry)}`,
      );
    }
    if (match[2] === '*') families.add(match[1] ?? '');
    else exact.add(type);
  }
  return (mimeType) => {
    const type = (mimeType.split(';')[0] ?? '').trim().toLowerCase();
    return exact.has(type) || families.has(type.split('/')[0] ?? '');
  };
}

function positive(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`multipart: ${name} must be a positive integer, got ${String(value)}`);
  }
  return value;
}

function ignore(): void {
  // The error reaches the caller through the generator instead.
}

function tooLarge(message: string): HttpError {
  return new HttpError(413, message);
}
