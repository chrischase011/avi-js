import { STATUS_CODES, type OutgoingHttpHeaders, type ServerResponse } from 'node:http';
import { HttpError } from './errors.js';
import { Reply } from './reply.js';

const JSON_TYPE = 'application/json; charset=utf-8';
const TEXT_TYPE = 'text/plain; charset=utf-8';
const BINARY_TYPE = 'application/octet-stream';

interface ErrorBody {
  statusCode: number;
  error: string;
  message?: string;
}

export interface SendOptions {
  /** Applied before `reply()` headers, which win on conflict. */
  headers?: OutgoingHttpHeaders | undefined;
  /** Status when the value does not set one. Default: 200, or 204 without a body. */
  status?: number;
  close: boolean;
}

/** Writes a handler result. Throws before touching `res` if the value cannot be serialized. */
export function sendValue(res: ServerResponse, value: unknown, options: SendOptions): void {
  let body = value;
  let status: number | undefined;
  let headers: OutgoingHttpHeaders | undefined;
  if (value instanceof Reply) {
    ({ body, status, headers } = value);
  }
  status ??= options.status ?? (body === undefined ? 204 : 200);

  let payload: string | Uint8Array | undefined;
  let type: string | undefined;
  if (body === undefined) {
    payload = undefined;
  } else if (typeof body === 'string') {
    payload = body;
    type = TEXT_TYPE;
  } else if (body instanceof Uint8Array) {
    payload = body;
    type = BINARY_TYPE;
  } else {
    const json = JSON.stringify(body) as string | undefined;
    if (json === undefined) throw new TypeError(`Cannot serialize a ${typeof body} response`);
    payload = json;
    type = JSON_TYPE;
  }

  if (options.headers) setHeaders(res, options.headers);
  if (headers) setHeaders(res, headers);
  finish(res, status, payload, type, options.close || status === 413);
}

/** Writes a safe error response. Only 4xx `HttpError` messages reach the client. */
export function sendError(
  res: ServerResponse,
  error: unknown,
  extra: OutgoingHttpHeaders | undefined,
  close: boolean,
): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  clearHeaders(res);

  const status = statusOf(error);
  const body: ErrorBody = { statusCode: status, error: STATUS_CODES[status] ?? 'Error' };
  if (status < 500 && error instanceof HttpError) body.message = error.message;

  try {
    if (extra) setHeaders(res, extra);
    if (error instanceof HttpError && error.headers) setHeaders(res, error.headers);
  } catch {
    clearHeaders(res);
  }

  finish(res, status, JSON.stringify(body), JSON_TYPE, close || status === 413);
}

/** `204` with an `Allow` header, for `OPTIONS` requests without their own route. */
export function sendOptions(
  res: ServerResponse,
  allow: string,
  extra: OutgoingHttpHeaders | undefined,
  close: boolean,
): void {
  if (extra) setHeaders(res, extra);
  res.setHeader('allow', allow);
  finish(res, 204, undefined, undefined, close);
}

export function statusOf(error: unknown): number {
  return error instanceof HttpError ? error.status : 500;
}

export function clearHeaders(res: ServerResponse): void {
  for (const name of res.getHeaderNames()) res.removeHeader(name);
}

function setHeaders(res: ServerResponse, headers: OutgoingHttpHeaders): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) res.setHeader(name, value);
  }
}

function finish(
  res: ServerResponse,
  status: number,
  payload: string | Uint8Array | undefined,
  type: string | undefined,
  close: boolean,
): void {
  res.statusCode = status;
  res.setHeader('x-content-type-options', 'nosniff');
  if (close) res.setHeader('connection', 'close');

  if (payload === undefined || status === 204 || status === 304) {
    res.end();
    return;
  }
  if (type && !res.hasHeader('content-type')) res.setHeader('content-type', type);
  res.setHeader(
    'content-length',
    typeof payload === 'string' ? Buffer.byteLength(payload) : payload.byteLength,
  );
  res.end(payload);
}
