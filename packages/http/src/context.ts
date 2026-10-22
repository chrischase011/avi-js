import {
  validateHeaderName,
  validateHeaderValue,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http';
import { HttpError, RequestAbortedError } from './errors.js';
import type { HttpMethod } from './methods.js';
import type { Params } from './router.js';

/**
 * Per-request data shared by middleware, guards and handlers. Apps add typed keys:
 * `declare module '@avi/core' { interface AviState { user?: User } }`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by apps
export interface AviState {}

/** The `input` type of a route without schemas. */
// eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- deliberately has no keys
export type NoInput = Record<never, never>;

/**
 * The request as handlers see it. `I` types `ctx.input` (validated data) and `P` types
 * `ctx.params`; both are filled in by `route()` and schemas.
 */
export interface Context<I extends object = NoInput, P extends object = Params> {
  readonly method: HttpMethod;
  /** Raw path without the query string. */
  readonly path: string;
  /** Decoded route parameters. A trailing `*` is available as `params['*']`. */
  readonly params: P;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  /** Aborts when the client disconnects before the response is sent. */
  readonly signal: AbortSignal;
  readonly req: IncomingMessage;
  /** Validated `params`, `query` and `body`, for routes with a schema. */
  readonly input: Readonly<I>;
  /** A fresh object for each request. */
  readonly state: AviState & Record<string, unknown>;
  /** Adds a response header. Headers from `reply()` or an `HttpError` win on conflict. */
  setHeader(name: string, value: string | number | readonly string[]): void;
  /** Reads the body as UTF-8 text, up to the body limit. */
  text(): Promise<string>;
  /** Reads and parses a JSON body. Rejects with 415 or 400 on bad input. */
  json(): Promise<unknown>;
}

const EMPTY_INPUT: NoInput = Object.freeze({});

export class RequestContext implements Context {
  readonly #res: ServerResponse;
  readonly #rawQuery: string;
  readonly #bodyLimit: number;
  #query: URLSearchParams | undefined;
  #abort: AbortController | undefined;
  #body: Promise<Buffer> | undefined;
  #state: (AviState & Record<string, unknown>) | undefined;
  #headers: OutgoingHttpHeaders | undefined;
  /** Set once by the validation step, before the handler runs. */
  input: NoInput = EMPTY_INPUT;

  constructor(
    readonly req: IncomingMessage,
    res: ServerResponse,
    readonly method: HttpMethod,
    readonly path: string,
    readonly params: Params,
    rawQuery: string,
    bodyLimit: number,
  ) {
    this.#res = res;
    this.#rawQuery = rawQuery;
    this.#bodyLimit = bodyLimit;
  }

  get headers(): IncomingHttpHeaders {
    return this.req.headers;
  }

  get query(): URLSearchParams {
    return (this.#query ??= new URLSearchParams(this.#rawQuery));
  }

  get state(): AviState & Record<string, unknown> {
    return (this.#state ??= {});
  }

  /** Headers collected through `setHeader`, if any. */
  get responseHeaders(): OutgoingHttpHeaders | undefined {
    return this.#headers;
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    const stored = typeof value === 'object' ? [...value] : value;
    validateHeaderName(name);
    validateHeaderValue(name, stored as string);
    (this.#headers ??= {})[name.toLowerCase()] = stored;
  }

  get signal(): AbortSignal {
    if (!this.#abort) {
      const controller = new AbortController();
      const res = this.#res;
      if (res.destroyed && !res.writableFinished) controller.abort();
      else
        res.once('close', () => {
          if (!res.writableFinished) controller.abort();
        });
      this.#abort = controller;
    }
    return this.#abort.signal;
  }

  async text(): Promise<string> {
    const body = await (this.#body ??= readBody(this.req, this.#bodyLimit));
    return body.toString('utf8');
  }

  async json(): Promise<unknown> {
    if (!isJson(this.req.headers['content-type'])) {
      throw new HttpError(415, 'Expected a JSON request body');
    }
    const text = await this.text();
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new HttpError(400, 'Malformed JSON body', { cause: error });
    }
  }
}

function isJson(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const end = contentType.indexOf(';');
  const mime = (end === -1 ? contentType : contentType.slice(0, end)).trim().toLowerCase();
  return mime === 'application/json' || (mime.startsWith('application/') && mime.endsWith('+json'));
}

function tooLarge(limit: number): HttpError {
  return new HttpError(413, `Request body exceeds ${String(limit)} bytes`);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (declared > limit) return Promise.reject(tooLarge(limit));
  if (req.readableEnded) return Promise.resolve(Buffer.alloc(0));

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        cleanup();
        req.pause();
        reject(tooLarge(limit));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new RequestAbortedError('Request aborted', { cause: error }));
    };
    const onClose = () => {
      cleanup();
      reject(new RequestAbortedError('Request aborted'));
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}
