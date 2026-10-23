import type { OutgoingHttpHeaders } from 'node:http';

export interface ReplyInit {
  status?: number;
  headers?: OutgoingHttpHeaders;
}

/** A handler result with a status code or headers. `T` is the body type, for typed clients. */
export class Reply<T = unknown> {
  constructor(
    readonly body: T,
    readonly status: number | undefined,
    readonly headers: OutgoingHttpHeaders | undefined,
  ) {}
}

/** Wraps a handler result to set the status code or headers. */
export function reply<T>(body: T, init: ReplyInit = {}): Reply<T> {
  const { status, headers } = init;
  if (status !== undefined && (!Number.isInteger(status) || status < 200 || status > 599)) {
    throw new RangeError(`Reply status must be an integer from 200 to 599, got ${String(status)}`);
  }
  return new Reply(body, status, headers);
}

export function isReply(value: unknown): value is Reply {
  return value instanceof Reply;
}
