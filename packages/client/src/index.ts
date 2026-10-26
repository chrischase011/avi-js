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
    ? { query?: Q }
    : { query: Q };
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

type ResponseOf<E> = E extends EndpointShape ? E['response'] : never;

type Call<A, M extends Method> = <P extends PathsOf<A, M>>(
  path: P,
  ...args: RequestArgs<EndpointAt<A, M, P>>
) => Promise<ResponseOf<EndpointAt<A, M, P>>>;

type RawCall<A, M extends Method> = <P extends PathsOf<A, M>>(
  path: P,
  ...args: RequestArgs<EndpointAt<A, M, P>>
) => Promise<Response>;

export interface Client<A> {
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

  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
  const calls = Object.fromEntries(methods.map((m) => [m.toLowerCase(), call(m)]));
  const raws = Object.fromEntries(methods.map((m) => [m.toLowerCase(), raw(m)]));
  return Object.freeze({ ...calls, raw: Object.freeze(raws) }) as unknown as Client<A>;
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
      const value = params[name];
      if (value === undefined)
        throw new TypeError(`Missing path parameter "${name}" for ${pattern}`);
      const text = String(value);
      // A wildcard may span segments; encode each one.
      const parts = segment === '*' ? text.split('/') : [text];
      if (parts.some((part) => part === '.' || part === '..')) {
        // URLs resolve these (even encoded as %2E), so the request would reach another route.
        throw new TypeError(`Path parameter "${name}" cannot be "." or "..": ${text}`);
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
