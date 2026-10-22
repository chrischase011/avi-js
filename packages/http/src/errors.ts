import { STATUS_CODES, type OutgoingHttpHeaders } from 'node:http';

export interface HttpErrorOptions {
  cause?: unknown;
  /** Sent with the error response, e.g. `allow` or `retry-after`. */
  headers?: OutgoingHttpHeaders;
}

/** An error with an HTTP status. 4xx messages are sent to the client; 5xx messages never are. */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number;
  readonly headers: OutgoingHttpHeaders | undefined;

  constructor(status: number, message?: string, options?: HttpErrorOptions) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new RangeError(
        `HttpError status must be an integer from 400 to 599, got ${String(status)}`,
      );
    }
    super(message ?? STATUS_CODES[status] ?? 'Error', options);
    this.status = status;
    this.headers = options?.headers;
  }
}

/** The client went away before the request body was fully read. */
export class RequestAbortedError extends Error {
  override readonly name = 'RequestAbortedError';
}
