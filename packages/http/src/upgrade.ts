import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Context } from './context.js';
import { HttpError } from './errors.js';

/** What a route that accepts an upgrade gets: the connection is its own from then on. */
export interface UpgradeConnection {
  readonly req: IncomingMessage;
  readonly socket: Duplex;
  /** Bytes the client sent after its request headers, the start of the new protocol. */
  readonly head: Buffer;
  /** Aborts when the server shuts down, so the connection can be closed politely. */
  readonly signal: AbortSignal;
  /** Headers set on the request so far (request id, `setHeader`), for the `101` response. */
  readonly headers: OutgoingHttpHeaders;
}

export interface UpgradeOptions {
  /** The protocol in the client's `Upgrade` header, such as `websocket`. Any other is a 426. */
  protocol: string;
}

/** A handler result that takes over the connection. Created by `upgrade()`. */
export class Upgrade {
  constructor(
    readonly protocol: string,
    readonly accept: (connection: UpgradeConnection) => unknown,
  ) {}
}

// Set by the server for requests that came in through its `upgrade` event.
export const upgradeRequests = new WeakSet<Context>();

/**
 * Low level, for protocol libraries such as `@avijs/websocket`. Accepts this upgrade request:
 * return the result from the handler and `accept` gets the socket once the route's guards and
 * middleware have passed. A plain request, or one asking for another protocol, gets a 426.
 */
export function upgrade(
  ctx: Context,
  accept: (connection: UpgradeConnection) => unknown,
  options: UpgradeOptions,
): Upgrade {
  const asked = ctx.headers.upgrade?.toLowerCase();
  if (!upgradeRequests.has(ctx) || asked !== options.protocol.toLowerCase()) {
    throw new HttpError(426, `This route expects a ${options.protocol} connection`, {
      headers: { connection: 'Upgrade', upgrade: options.protocol },
    });
  }
  return new Upgrade(options.protocol, accept);
}
