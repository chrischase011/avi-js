import type { OutgoingHttpHeaders } from 'node:http';

export interface ReplyInit {
  status?: number;
  headers?: OutgoingHttpHeaders;
}

export class Reply {
  constructor(
    readonly body: unknown,
    readonly status: number | undefined,
    readonly headers: OutgoingHttpHeaders | undefined,
  ) {}
}

/** Wraps a handler result to set the status code or headers. */
export function reply(body: unknown, init: ReplyInit = {}): Reply {
  const { status, headers } = init;
  if (status !== undefined && (!Number.isInteger(status) || status < 200 || status > 599)) {
    throw new RangeError(`Reply status must be an integer from 200 to 599, got ${String(status)}`);
  }
  return new Reply(body, status, headers);
}

export function isReply(value: unknown): value is Reply {
  return value instanceof Reply;
}
