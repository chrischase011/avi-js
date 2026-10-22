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

/** Writes a handler result. Throws before touching `res` if the value cannot be serialized. */
export function sendValue(res: ServerResponse, value: unknown, closeConnection: boolean): void {
  let body = value;
  let status: number | undefined;
  let headers: OutgoingHttpHeaders | undefined;
  if (value instanceof Reply) {
    ({ body, status, headers } = value);
  }

  if (body === undefined) {
    if (headers) setHeaders(res, headers);
    finish(res, status ?? 204, undefined, undefined, closeConnection);
    return;
  }

  let payload: string | Uint8Array;
  let type: string;
  if (typeof body === 'string') {
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

  if (headers) setHeaders(res, headers);
  finish(res, status ?? 200, payload, type, closeConnection);
}

/** Writes a safe error response. Only 4xx `HttpError` messages reach the client. */
export function sendError(res: ServerResponse, error: unknown, closeConnection: boolean): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  for (const name of res.getHeaderNames()) res.removeHeader(name);

  const status = error instanceof HttpError ? error.status : 500;
  const body: ErrorBody = { statusCode: status, error: STATUS_CODES[status] ?? 'Error' };
  if (status < 500 && error instanceof HttpError) body.message = error.message;

  finish(res, status, JSON.stringify(body), JSON_TYPE, closeConnection || status === 413);
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
  closeConnection: boolean,
): void {
  res.statusCode = status;
  res.setHeader('x-content-type-options', 'nosniff');
  if (closeConnection) res.setHeader('connection', 'close');

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
