/** What a client sends and receives for one route, as `avi client` generates it. */
export interface EndpointShape {
  readonly params: object;
  /** `undefined` when the route has no query schema: any query is allowed. */
  readonly query: unknown;
  /** `undefined` when the route has no body schema: any body is allowed. */
  readonly body: unknown;
  readonly response: unknown;
}

/** An API description: `'GET /users/:id'` style keys mapped to endpoints. */
export type ApiShape<A> = { readonly [K in keyof A]: EndpointShape };

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Readonly<Record<string, QueryValue | readonly QueryValue[]>>;
export type HeadersLike = Headers | Readonly<Record<string, string>> | readonly [string, string][];
type HeadersArg = ConstructorParameters<typeof Headers>[0];

/** Paths of `A` that answer method `M`. */
export type PathsOf<A, M extends Method> = keyof A extends infer K
  ? K extends `${M} ${infer P}`
    ? P
    : never
  : never;

export type EndpointAt<A, M extends Method, P extends string> = A[`${M} ${P}` & keyof A];

type ParamsOption<P> = [keyof P] extends [never]
  ? { params?: undefined }
  : { params: { readonly [K in keyof P]: string | number } };
type QueryOption<Q> = [Q] extends [undefined]
  ? { query?: Query }
  : object extends Q
    ? { query?: LooseQuery<Q> }
    : { query: LooseQuery<Q> };

// Query values are sent as text, so where the schema takes any string, a number or boolean is fine.
type LooseQuery<Q> = { readonly [K in keyof Q]: Loose<Q[K]> };
type Loose<T> = T extends string
  ? string extends T
    ? string | number | boolean
    : T extends `${number}`
      ? T | number
      : T
  : T extends readonly (infer U)[]
    ? readonly Loose<U>[]
    : T;
type BodyOption<B> = [B] extends [undefined]
  ? { body?: unknown }
  : undefined extends B
    ? { body?: B }
    : object extends B
      ? { body?: B }
      : { body: B };

export type RequestOptions<E> = (E extends EndpointShape
  ? ParamsOption<E['params']> & QueryOption<E['query']> & BodyOption<E['body']>
  : never) & {
  readonly headers?: HeadersLike;
  readonly signal?: AbortSignal;
};

export type RequestArgs<E> =
  object extends RequestOptions<E> ? [options?: RequestOptions<E>] : [options: RequestOptions<E>];

type EndpointResponse<E> = E extends EndpointShape ? E['response'] : never;

/** The JSON response of an endpoint: `ResponseOf<Api, 'GET /teams'>`. */
export type ResponseOf<A, K extends keyof A> = EndpointResponse<A[K]>;
/** The request body an endpoint takes: `BodyOf<Api, 'POST /teams'>`. */
export type BodyOf<A, K extends keyof A> = A[K] extends EndpointShape ? A[K]['body'] : never;
/** The query an endpoint takes, before the client stringifies it. */
export type QueryOf<A, K extends keyof A> = A[K] extends EndpointShape ? A[K]['query'] : never;
/** The path parameters of an endpoint. */
export type ParamsOf<A, K extends keyof A> = A[K] extends EndpointShape ? A[K]['params'] : never;

type Call<A, M extends Method> = <P extends PathsOf<A, M>>(
  path: P,
  ...args: RequestArgs<EndpointAt<A, M, P>>
) => Promise<EndpointResponse<EndpointAt<A, M, P>>>;

type RawCall<A, M extends Method> = <P extends PathsOf<A, M>>(
  path: P,
  ...args: RequestArgs<EndpointAt<A, M, P>>
) => Promise<Response>;

/** One server-sent event. `data` is the text sent; objects from `sse()` arrive as JSON text. */
export interface SseMessage {
  /** The event's name, `message` when the server gave none. */
  readonly event: string;
  readonly data: string;
  /** The last id the server sent, if any. */
  readonly id?: string;
}

type EventsCall<A> = <P extends PathsOf<A, 'GET'>>(
  path: P,
  ...args: RequestArgs<EndpointAt<A, 'GET', P>>
) => AsyncIterable<SseMessage>;

export interface Client<A> {
  /**
   * Reads a server-sent event stream with `fetch`, so headers such as a token are sent, which
   * `EventSource` cannot do. Ends when the server closes the stream, the loop breaks, or `signal`
   * aborts; it does not reconnect.
   */
  readonly events: EventsCall<A>;
  readonly get: Call<A, 'GET'>;
  readonly post: Call<A, 'POST'>;
  readonly put: Call<A, 'PUT'>;
  readonly patch: Call<A, 'PATCH'>;
  readonly delete: Call<A, 'DELETE'>;
  readonly head: Call<A, 'HEAD'>;
  readonly options: Call<A, 'OPTIONS'>;
  /** The same calls, returning the `Response` untouched and never throwing for a status. */
  readonly raw: {
    readonly get: RawCall<A, 'GET'>;
    readonly post: RawCall<A, 'POST'>;
    readonly put: RawCall<A, 'PUT'>;
    readonly patch: RawCall<A, 'PATCH'>;
    readonly delete: RawCall<A, 'DELETE'>;
    readonly head: RawCall<A, 'HEAD'>;
    readonly options: RawCall<A, 'OPTIONS'>;
  };
}

export interface ClientOptions {
  /** Where the API lives, such as `https://api.example.com` or `/api`. */
  readonly baseUrl: string | URL;
  /** Sent with every request; a function runs per request, e.g. to add a fresh token. */
  readonly headers?: HeadersLike | (() => HeadersLike | Promise<HeadersLike>);
  /** Defaults to the global `fetch`. */
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** Extra `fetch` options for every request, such as `credentials: 'include'`. */
  readonly init?: Omit<RequestInit, 'method' | 'body' | 'headers' | 'signal'>;
}

/** A response outside 2xx. `body` is Avi.js's error JSON when the server sent one. */
export class AviClientError extends Error {
  override readonly name = 'AviClientError';

  constructor(
    readonly method: Method,
    readonly path: string,
    readonly response: Response,
    readonly body: unknown,
  ) {
    super(`${method} ${path} failed with ${String(response.status)}: ${describe(body, response)}`);
  }

  get status(): number {
    return this.response.status;
  }

  /** The server's request id, for finding the request in its logs. */
  get requestId(): string | undefined {
    return this.response.headers.get('x-request-id') ?? undefined;
  }
}

/**
 * Creates a typed client for an Avi.js API. `A` is the `Api` type `avi client` generates:
 * `createClient<Api>({ baseUrl: 'http://localhost:3000' })`.
 */
export function createClient<A extends ApiShape<A>>(options: ClientOptions): Client<A> {
  const base = String(options.baseUrl).replace(/\/+$/, '');
  // Paths are appended to it, so they would land in the query or the fragment.
  if (/[?#]/.test(base)) {
    throw new TypeError(`createClient: baseUrl cannot have a query or fragment: ${base}`);
  }

  const send = async (method: Method, path: string, init: Options = {}): Promise<Response> => {
    const defaults =
      typeof options.headers === 'function' ? await options.headers() : options.headers;
    const headers = new Headers(defaults as HeadersArg);
    for (const [name, value] of new Headers(init.headers as HeadersArg)) {
      headers.set(name, value);
    }
    const fetcher = options.fetch ?? fetch;
    return fetcher(`${base}${fillPath(path, init.params)}${queryString(init.query)}`, {
      ...options.init,
      method,
      headers,
      body: encodeBody(init.body, headers),
      signal: init.signal ?? null,
    });
  };

  const call =
    (method: Method) =>
    async (path: string, init?: Options): Promise<unknown> => {
      const response = await send(method, path, init);
      if (!response.ok) {
        throw new AviClientError(method, path, response, await readBody(response, method));
      }
      return readBody(response, method);
    };
  const raw = (method: Method) => (path: string, init?: Options) => send(method, path, init);

  const events = (path: string, init: Options = {}): AsyncIterable<SseMessage> => ({
    async *[Symbol.asyncIterator]() {
      const headers = new Headers(init.headers as HeadersArg);
      if (!headers.has('accept')) headers.set('accept', 'text/event-stream');
      try {
        const response = await send('GET', path, { ...init, headers });
        if (!response.ok) {
          throw new AviClientError('GET', path, response, await readBody(response, 'GET'));
        }
        if (response.body) yield* readEvents(response.body);
      } catch (error) {
        // Aborting is how a caller stops listening, not a failure.
        if (!init.signal?.aborted) throw error;
      }
    },
  });

  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
  const calls = Object.fromEntries(methods.map((m) => [m.toLowerCase(), call(m)]));
  const raws = Object.fromEntries(methods.map((m) => [m.toLowerCase(), raw(m)]));
  return Object.freeze({ ...calls, events, raw: Object.freeze(raws) }) as unknown as Client<A>;
}

/** Parses an event stream as the HTML spec describes; `retry` is ignored since nothing reconnects. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let event = '';
  let id: string | undefined;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A chunk ending in \r may be half of a \r\n; at the end of the stream it is a line break.
      const end = !done && buffer.endsWith('\r') ? buffer.length - 1 : buffer.length;
      const lines = buffer.slice(0, end).split(/\r\n|\r|\n/);
      buffer = (lines.pop() ?? '') + buffer.slice(end);
      for (const line of lines) {
        if (line === '') {
          if (data.length > 0) {
            yield {
              event: event || 'message',
              data: data.join('\n'),
              ...(id === undefined ? {} : { id }),
            };
          }
          data = [];
          event = '';
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let text = colon === -1 ? '' : line.slice(colon + 1);
        if (text.startsWith(' ')) text = text.slice(1);
        if (field === 'data') data.push(text);
        else if (field === 'event') event = text;
        else if (field === 'id' && !text.includes('\0')) id = text;
      }
      // What is left is an event the stream cut off; the format drops it.
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

interface Options {
  readonly params?: Readonly<Record<string, string | number>>;
  readonly query?: Query;
  readonly body?: unknown;
  readonly headers?: HeadersLike;
  readonly signal?: AbortSignal;
}

/** Fills `:name` and `*` segments of a route pattern, encoding each value. */
export function fillPath(
  pattern: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return pattern
    .split('/')
    .map((segment) => {
      if (segment !== '*' && !segment.startsWith(':')) return segment;
      const name = segment === '*' ? '*' : segment.slice(1);
      const value = Object.hasOwn(params, name) ? params[name] : undefined;
      if (value === undefined)
        throw new TypeError(`Missing path parameter "${name}" for ${pattern}`);
      const text = String(value);
      // A whole empty wildcard is the route's own path, the same as on the server.
      if (segment === '*' && text === '') return '';
      // A wildcard may span segments; encode each one.
      const parts = segment === '*' ? text.split('/') : [text];
      for (const part of parts) {
        // URLs resolve these (even encoded as %2E), so the request would reach another route.
        if (part === '.' || part === '..') {
          throw new TypeError(`Path parameter "${name}" cannot be "." or "..": ${text}`);
        }
        // /users/ is the route /users, and a leading // starts another host.
        if (part === '') throw new TypeError(`Path parameter "${name}" cannot be empty: ${text}`);
      }
      return parts.map(encodeURIComponent).join('/');
    })
    .join('/');
}

export function queryString(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? (value as readonly QueryValue[]) : [value]) {
      if (item !== undefined && item !== null) params.append(key, String(item));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function encodeBody(body: unknown, headers: Headers): RequestInit['body'] {
  if (body === undefined) return null;
  if (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof ReadableStream
  ) {
    return body as RequestInit['body'];
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return JSON.stringify(body);
}

/** JSON is parsed, text is read, streams and binary come back as the `Response`. */
async function readBody(response: Response, method: Method): Promise<unknown> {
  if (method === 'HEAD' || response.status === 204 || response.status === 205) return undefined;
  const type = response.headers.get('content-type') ?? '';
  if (/[/+]json\b/.test(type)) {
    const text = await response.text();
    return text === '' ? undefined : (JSON.parse(text) as unknown);
  }
  if (type.startsWith('text/') && !type.startsWith('text/event-stream')) return response.text();
  if (type === '' && response.headers.get('content-length') === '0') return undefined;
  return response;
}

function describe(body: unknown, response: Response): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    return String(body.message);
  }
  return typeof body === 'string' && body !== '' ? body : response.statusText;
}
