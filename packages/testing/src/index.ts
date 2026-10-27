import {
  fillPath,
  queryString,
  type ApiShape,
  type EndpointAt,
  type EndpointShape,
  type HeadersLike,
  type Method,
  type PathsOf,
  type Query,
  type RequestArgs,
} from '@avijs/client';
import {
  createAvi,
  type AviApp,
  type AviOptions,
  type ModuleOptions,
  type ModuleRef,
} from '@avijs/core';

type HeadersArg = ConstructorParameters<typeof Headers>[0];

export interface TestRequest {
  /** Objects are sent as JSON; strings, bytes and forms as they are. */
  body?: unknown;
  headers?: HeadersLike;
  query?: Query;
}

export interface TestResponse {
  /** True for a 2xx status. */
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  /** Parsed JSON for JSON responses, otherwise the text. */
  readonly body: unknown;
  readonly text: string;
}

export interface TestClient<A = never> {
  readonly app: AviApp;
  /** The base URL the app is listening on, such as `http://127.0.0.1:52341`. */
  readonly url: string;
  request(method: string, path: string, init?: TestRequest): Promise<TestResponse>;
  get(path: string, init?: TestRequest): Promise<TestResponse>;
  post(path: string, body?: unknown, init?: TestRequest): Promise<TestResponse>;
  put(path: string, body?: unknown, init?: TestRequest): Promise<TestResponse>;
  patch(path: string, body?: unknown, init?: TestRequest): Promise<TestResponse>;
  delete(path: string, init?: TestRequest): Promise<TestResponse>;
  /**
   * Calls typed by the `Api` that `avi client` generates, for `createTestClient<Api>(...)`.
   * Same shape as `@avijs/client`, but a status never throws.
   */
  readonly api: TestApi<A>;
  /**
   * The same client, sending these headers on every request, such as a user's token. Headers
   * passed to a call still win. Calls from either client reach the same app.
   */
  withHeaders(headers: HeadersLike): TestClient<A>;
  /** Closes the app, which also disposes its providers. */
  close(): Promise<void>;
}

/** A response from `client.api`: `body` is typed when `ok` is true. */
export type TypedTestResponse<T> =
  | (Omit<TestResponse, 'ok' | 'body'> & { readonly ok: true; readonly body: T })
  | (Omit<TestResponse, 'ok'> & { readonly ok: false });

type TestCall<A, M extends Method> = <P extends PathsOf<A, M>>(
  path: P,
  ...args: RequestArgs<EndpointAt<A, M, P>>
) => Promise<TypedTestResponse<ResponseOf<EndpointAt<A, M, P>>>>;

type ResponseOf<E> = E extends EndpointShape ? E['response'] : never;

export interface TestApi<A> {
  readonly get: TestCall<A, 'GET'>;
  readonly post: TestCall<A, 'POST'>;
  readonly put: TestCall<A, 'PUT'>;
  readonly patch: TestCall<A, 'PATCH'>;
  readonly delete: TestCall<A, 'DELETE'>;
  readonly head: TestCall<A, 'HEAD'>;
  readonly options: TestCall<A, 'OPTIONS'>;
}

/**
 * Starts an app on a random local port and returns a small HTTP client for it. Pass a module and
 * options (including `overrides` to swap providers for fakes), or an app you built yourself.
 * Pass the generated `Api` type for typed calls: `createTestClient<Api>(AppModule)`.
 */
export async function createTestClient<A extends ApiShape<A> = never>(
  target: AviApp | ModuleRef | ModuleOptions,
  options: AviOptions = {},
): Promise<TestClient<A>> {
  const app = isApp(target)
    ? target
    : createAvi({ startupSummary: false, ...options }).register(target);
  const { port } = await app.listen(0, '127.0.0.1');
  return client<A>(app, `http://127.0.0.1:${String(port)}`, new Headers());
}

function client<A>(app: AviApp, url: string, defaults: Headers): TestClient<A> {
  const request = async (method: string, path: string, init: TestRequest = {}) => {
    const headers = new Headers(defaults);
    for (const [name, value] of new Headers(init.headers as HeadersArg)) headers.set(name, value);
    let body: string | Uint8Array | FormData | URLSearchParams | Blob | undefined;
    if (init.body !== undefined) {
      if (isRawBody(init.body)) {
        body = init.body;
      } else {
        body = JSON.stringify(init.body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
    }
    const response = await fetch(`${url}${path}${queryString(init.query)}`, {
      method,
      headers,
      body: body ?? null,
    });
    const text = await response.text();
    const type = response.headers.get('content-type') ?? '';
    const parsed: unknown = /[/+]json\b/.test(type) && text !== '' ? JSON.parse(text) : text;
    const { ok, status } = response;
    return { ok, status, headers: response.headers, body: parsed, text };
  };

  const typed =
    (method: Method) =>
    (path: string, init: TypedInit = {}) =>
      request(method, fillPath(path, init.params), init);

  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
  const api = Object.fromEntries(methods.map((m) => [m.toLowerCase(), typed(m)]));

  return {
    app,
    url,
    request,
    get: (path, init) => request('GET', path, init),
    post: (path, body, init) => request('POST', path, { ...init, body }),
    put: (path, body, init) => request('PUT', path, { ...init, body }),
    patch: (path, body, init) => request('PATCH', path, { ...init, body }),
    delete: (path, init) => request('DELETE', path, init),
    api: Object.freeze(api) as unknown as TestApi<A>,
    withHeaders: (extra) => {
      const headers = new Headers(defaults);
      for (const [name, value] of new Headers(extra as HeadersArg)) headers.set(name, value);
      return client<A>(app, url, headers);
    },
    close: () => app.close(),
  };
}

interface TypedInit extends TestRequest {
  params?: Readonly<Record<string, string | number>>;
}

function isRawBody(body: unknown): body is string | Uint8Array | FormData | URLSearchParams | Blob {
  return (
    typeof body === 'string' ||
    body instanceof Uint8Array ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob
  );
}

function isApp(value: unknown): value is AviApp {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<AviApp>).listen === 'function' &&
    typeof (value as Partial<AviApp>).register === 'function'
  );
}
