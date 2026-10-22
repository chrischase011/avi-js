import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerOptions as NodeServerOptions,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { RequestContext, type Context } from './context.js';
import { HttpError, RequestAbortedError } from './errors.js';
import type { HttpMethod } from './methods.js';
import { clearHeaders, sendError, sendOptions, sendValue, statusOf } from './respond.js';
import type { Handler, RouteMatch, Router } from './router.js';

export interface Logger {
  error(message: string, error: unknown): void;
}

/**
 * Turns an error into a response value, like a handler. Without its own status the response
 * uses the error's (`HttpError.status`, else 500). If it throws, the built-in response is used.
 */
export type ErrorHandler = (error: unknown, ctx: Context) => unknown;

/**
 * Runs for every request before routing, including 404s and automatic `OPTIONS`. Return
 * `undefined` to continue, or a value to send it as the response, like a handler.
 */
export type RequestHook = (ctx: Context) => unknown;

export interface ResponseInfo {
  readonly method: string;
  readonly path: string;
  /** The matched route pattern, e.g. `/users/:id`. */
  readonly route: string | undefined;
  readonly status: number;
  /** Milliseconds from receiving the request to the end of the response. */
  readonly duration: number;
  /** The client disconnected before the response was complete. */
  readonly aborted: boolean;
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
  /** Passed to `node:http`. */
  keepAliveTimeout?: number;
  /** How often `node:http` enforces the timeouts above, in ms. Passed to `node:http`. */
  connectionsCheckingInterval?: number;
  /** Receives 5xx errors. Default: `console.error`. */
  logger?: Logger;
  errorHandler?: ErrorHandler;
  /** Run in order before routing, for every request. */
  onRequest?: readonly RequestHook[];
  /** Called after every response. Errors are logged, never sent. */
  onResponse?: (info: ResponseInfo) => unknown;
}

const PASSED_THROUGH = [
  'requestTimeout',
  'headersTimeout',
  'keepAliveTimeout',
  'connectionsCheckingInterval',
] as const;

const consoleLogger: Logger = {
  error(message, error) {
    console.error(message, error);
  },
};

const NO_PARAMS = Object.freeze(Object.create(null) as Record<string, string>);

export class HttpServer {
  readonly #router: Router;
  readonly #bodyLimit: number;
  readonly #shutdownTimeout: number;
  readonly #nodeOptions: NodeServerOptions;
  readonly #logger: Logger;
  readonly #errorHandler: ErrorHandler | undefined;
  readonly #hooks: readonly RequestHook[] | undefined;
  readonly #onResponse: ((info: ResponseInfo) => unknown) | undefined;
  #server: Server | undefined;
  #closing: Promise<void> | undefined;

  constructor(router: Router, options: ServerOptions = {}) {
    this.#router = router;
    this.#bodyLimit = nonNegative('bodyLimit', options.bodyLimit ?? 1024 * 1024);
    this.#shutdownTimeout = nonNegative('shutdownTimeout', options.shutdownTimeout ?? 10_000);
    this.#logger = options.logger ?? consoleLogger;
    this.#errorHandler = optionalFunction('errorHandler', options.errorHandler);
    this.#onResponse = optionalFunction('onResponse', options.onResponse);
    this.#hooks = hookList(options.onRequest);
    this.#nodeOptions = {};
    for (const name of PASSED_THROUGH) {
      const value = options[name];
      if (value !== undefined) this.#nodeOptions[name] = nonNegative(name, value);
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
    const match = this.#router.find(method, path);

    if (this.#onResponse) {
      this.#observe(res, method, path, match.kind === 'found' ? match.route : undefined);
    }

    const ctx = new RequestContext(
      req,
      res,
      method as HttpMethod,
      path,
      match.kind === 'found' ? match.params : NO_PARAMS,
      queryStart === -1 ? '' : url.slice(queryStart + 1),
      this.#bodyLimit,
    );

    if (this.#hooks) this.#runHooks(this.#hooks, 0, ctx, res, match);
    else this.#dispatch(ctx, res, match);
  }

  #runHooks(
    hooks: readonly RequestHook[],
    start: number,
    ctx: RequestContext,
    res: ServerResponse,
    match: RouteMatch,
  ): void {
    for (let i = start; i < hooks.length; i++) {
      let result: unknown;
      try {
        result = hooks[i]?.(ctx);
      } catch (error) {
        this.#fail(ctx, res, error);
        return;
      }
      if (result instanceof Promise) {
        result.then(
          (value: unknown) => {
            if (res.destroyed) return;
            if (value === undefined) this.#runHooks(hooks, i + 1, ctx, res, match);
            else this.#respond(ctx, res, value);
          },
          (error: unknown) => {
            this.#fail(ctx, res, error);
          },
        );
        return;
      }
      if (result !== undefined) {
        this.#respond(ctx, res, result);
        return;
      }
    }
    this.#dispatch(ctx, res, match);
  }

  #dispatch(ctx: RequestContext, res: ServerResponse, match: RouteMatch): void {
    let handler: Handler;
    switch (match.kind) {
      case 'found':
        handler = match.handler;
        break;
      case 'options':
        sendOptions(res, match.allow, ctx.responseHeaders, this.#closing !== undefined);
        return;
      case 'not-found':
        this.#fail(ctx, res, new HttpError(404));
        return;
      case 'malformed':
        this.#fail(ctx, res, new HttpError(400, 'Malformed URL encoding'));
        return;
      case 'method-not-allowed':
        this.#fail(ctx, res, new HttpError(405, undefined, { headers: { allow: match.allow } }));
        return;
    }

    let result: unknown;
    try {
      result = handler(ctx);
    } catch (error) {
      this.#fail(ctx, res, error);
      return;
    }

    if (result instanceof Promise) {
      result.then(
        (value: unknown) => {
          this.#respond(ctx, res, value);
        },
        (error: unknown) => {
          this.#fail(ctx, res, error);
        },
      );
    } else {
      this.#respond(ctx, res, result);
    }
  }

  #respond(ctx: RequestContext, res: ServerResponse, value: unknown): void {
    if (res.destroyed) return;
    try {
      sendValue(res, value, {
        headers: ctx.responseHeaders,
        close: this.#closing !== undefined,
        onStreamError: (error) => {
          this.#logger.error(`Response stream failed: ${ctx.method} ${ctx.path}`, error);
        },
      });
    } catch (error) {
      clearHeaders(res);
      this.#fail(ctx, res, error);
    }
  }

  #fail(ctx: RequestContext, res: ServerResponse, error: unknown): void {
    const expected =
      error instanceof RequestAbortedError || (error instanceof HttpError && error.status < 500);
    if (!expected) this.#logger.error(`Request failed: ${ctx.method} ${ctx.path}`, error);
    if (res.destroyed) return;

    const errorHandler = this.#errorHandler;
    if (!errorHandler) {
      sendError(res, error, ctx.responseHeaders, this.#closing !== undefined);
      return;
    }

    let value: unknown;
    try {
      value = errorHandler(error, ctx);
    } catch (handlerError) {
      this.#fallback(ctx, res, error, handlerError);
      return;
    }
    if (value instanceof Promise) {
      value.then(
        (resolved: unknown) => {
          this.#sendHandled(ctx, res, error, resolved);
        },
        (handlerError: unknown) => {
          this.#fallback(ctx, res, error, handlerError);
        },
      );
    } else {
      this.#sendHandled(ctx, res, error, value);
    }
  }

  #sendHandled(ctx: RequestContext, res: ServerResponse, error: unknown, value: unknown): void {
    if (res.destroyed) return;
    const headers: OutgoingHttpHeaders = { ...ctx.responseHeaders };
    if (error instanceof HttpError) Object.assign(headers, error.headers);
    try {
      clearHeaders(res);
      sendValue(res, value, {
        headers,
        status: statusOf(error),
        close: this.#closing !== undefined,
      });
    } catch (handlerError) {
      this.#fallback(ctx, res, error, handlerError);
    }
  }

  #fallback(ctx: RequestContext, res: ServerResponse, error: unknown, handlerError: unknown): void {
    this.#logger.error(`errorHandler failed: ${ctx.method} ${ctx.path}`, handlerError);
    if (!res.destroyed) sendError(res, error, ctx.responseHeaders, this.#closing !== undefined);
  }

  #observe(res: ServerResponse, method: string, path: string, route: string | undefined): void {
    const onResponse = this.#onResponse;
    if (!onResponse) return;
    const start = performance.now();
    res.once('close', () => {
      const info: ResponseInfo = {
        method,
        path,
        route,
        status: res.statusCode,
        duration: performance.now() - start,
        aborted: !res.writableFinished,
      };
      Promise.resolve()
        .then(() => onResponse(info))
        .catch((error: unknown) => {
          this.#logger.error('onResponse failed', error);
        });
    });
  }
}

function nonNegative(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${String(value)}`);
  }
  return value;
}

function hookList(hooks: readonly RequestHook[] | undefined): readonly RequestHook[] | undefined {
  if (hooks === undefined) return undefined;
  const value: unknown = hooks;
  if (!Array.isArray(value) || value.some((hook: unknown) => typeof hook !== 'function')) {
    throw new TypeError('onRequest must be an array of functions');
  }
  return hooks.length === 0 ? undefined : [...hooks];
}

function optionalFunction<F>(name: string, value: F | undefined): F | undefined {
  if (value !== undefined && typeof value !== 'function') {
    throw new TypeError(`${name} must be a function`);
  }
  return value;
}
