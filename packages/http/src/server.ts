import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerOptions as NodeServerOptions,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { RequestContext } from './context.js';
import { HttpError, RequestAbortedError } from './errors.js';
import type { HttpMethod } from './methods.js';
import { sendError, sendOptions, sendValue } from './respond.js';
import type { Router } from './router.js';

export interface Logger {
  error(message: string, error: unknown): void;
}

export interface ServerOptions {
  /** Maximum request body size in bytes. Default: 1 MiB. */
  bodyLimit?: number;
  /** How long `close()` waits for in-flight requests, in ms. Default: 10 000. */
  shutdownTimeout?: number;
  /** Passed to `node:http`. */
  requestTimeout?: number;
  /** Passed to `node:http`. */
  headersTimeout?: number;
  /** Receives 5xx errors. Default: `console.error`. */
  logger?: Logger;
}

const consoleLogger: Logger = {
  error(message, error) {
    console.error(message, error);
  },
};

export class HttpServer {
  readonly #router: Router;
  readonly #bodyLimit: number;
  readonly #shutdownTimeout: number;
  readonly #nodeOptions: NodeServerOptions;
  readonly #logger: Logger;
  #server: Server | undefined;
  #closing: Promise<void> | undefined;

  constructor(router: Router, options: ServerOptions = {}) {
    this.#router = router;
    this.#bodyLimit = nonNegative('bodyLimit', options.bodyLimit ?? 1024 * 1024);
    this.#shutdownTimeout = nonNegative('shutdownTimeout', options.shutdownTimeout ?? 10_000);
    this.#logger = options.logger ?? consoleLogger;
    this.#nodeOptions = {};
    if (options.requestTimeout !== undefined) {
      this.#nodeOptions.requestTimeout = nonNegative('requestTimeout', options.requestTimeout);
    }
    if (options.headersTimeout !== undefined) {
      this.#nodeOptions.headersTimeout = nonNegative('headersTimeout', options.headersTimeout);
    }
  }

  get listening(): boolean {
    return this.#server?.listening ?? false;
  }

  listen(port: number, host?: string): Promise<AddressInfo> {
    if (this.#server) return Promise.reject(new Error('Server is already listening'));

    const server = createServer(this.#nodeOptions, (req, res) => {
      this.#handle(req, res);
    });
    this.#server = server;

    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        this.#server = undefined;
        reject(error);
      };
      server.once('error', onError);
      server.listen({ port, host }, () => {
        server.off('error', onError);
        server.on('error', (error) => {
          this.#logger.error('HTTP server error', error);
        });
        resolve(server.address() as AddressInfo);
      });
    });
  }

  /** Stops accepting connections and waits for in-flight requests, up to `shutdownTimeout`. */
  close(): Promise<void> {
    const server = this.#server;
    if (!server) return Promise.resolve();

    this.#closing ??= new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => {
        server.closeAllConnections();
      }, this.#shutdownTimeout);
      force.unref();

      server.close((error) => {
        clearTimeout(force);
        this.#server = undefined;
        this.#closing = undefined;
        if (error) reject(error);
        else resolve();
      });
      server.closeIdleConnections();
    });
    return this.#closing;
  }

  #handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const queryStart = url.indexOf('?');
    const path = queryStart === -1 ? url : url.slice(0, queryStart);
    const method = req.method ?? 'GET';

    const closing = this.#closing !== undefined;
    const match = this.#router.find(method, path);
    switch (match.kind) {
      case 'found':
        break;
      case 'not-found':
        sendError(res, new HttpError(404), closing);
        return;
      case 'malformed':
        sendError(res, new HttpError(400, 'Malformed URL encoding'), closing);
        return;
      case 'method-not-allowed':
        sendError(res, new HttpError(405, undefined, { headers: { allow: match.allow } }), closing);
        return;
      case 'options':
        sendOptions(res, match.allow, closing);
        return;
    }

    const handler = match.handler;
    const ctx = new RequestContext(
      req,
      res,
      method as HttpMethod,
      path,
      match.params,
      queryStart === -1 ? '' : url.slice(queryStart + 1),
      this.#bodyLimit,
    );

    let result: unknown;
    try {
      result = handler(ctx);
    } catch (error) {
      this.#fail(res, error, method, path);
      return;
    }

    if (result instanceof Promise) {
      result.then(
        (value: unknown) => {
          this.#respond(res, value, method, path);
        },
        (error: unknown) => {
          this.#fail(res, error, method, path);
        },
      );
    } else {
      this.#respond(res, result, method, path);
    }
  }

  #respond(res: ServerResponse, value: unknown, method: string, path: string): void {
    if (res.destroyed) return;
    try {
      sendValue(res, value, this.#closing !== undefined);
    } catch (error) {
      this.#fail(res, error, method, path);
    }
  }

  #fail(res: ServerResponse, error: unknown, method: string, path: string): void {
    const expected =
      error instanceof RequestAbortedError || (error instanceof HttpError && error.status < 500);
    if (!expected) this.#logger.error(`Request failed: ${method} ${path}`, error);
    if (res.destroyed) return;
    sendError(res, error, this.#closing !== undefined);
  }
}

function nonNegative(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${String(value)}`);
  }
  return value;
}
