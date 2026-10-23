import {
  createAvi,
  type AviApp,
  type AviOptions,
  type ModuleOptions,
  type ModuleRef,
} from '@avijs/core';

export interface TestRequest {
  /** Objects are sent as JSON; strings and bytes as they are. */
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | readonly string[]>;
}

export interface TestResponse {
  readonly status: number;
  readonly headers: Headers;
  /** Parsed JSON for JSON responses, otherwise the text. */
  readonly body: unknown;
  readonly text: string;
}

export interface TestClient {
  readonly app: AviApp;
  /** The base URL the app is listening on, such as `http://127.0.0.1:52341`. */
  readonly url: string;
  request(method: string, path: string, init?: TestRequest): Promise<TestResponse>;
  get(path: string, init?: TestRequest): Promise<TestResponse>;
  post(path: string, body?: unknown, init?: TestRequest): Promise<TestResponse>;
  put(path: string, body?: unknown, init?: TestRequest): Promise<TestResponse>;
  patch(path: string, body?: unknown, init?: TestRequest): Promise<TestResponse>;
  delete(path: string, init?: TestRequest): Promise<TestResponse>;
  /** Closes the app, which also disposes its providers. */
  close(): Promise<void>;
}

/**
 * Starts an app on a random local port and returns a small HTTP client for it. Pass a module and
 * options (including `overrides` to swap providers for fakes), or an app you built yourself.
 */
export async function createTestClient(
  target: AviApp | ModuleRef | ModuleOptions,
  options: AviOptions = {},
): Promise<TestClient> {
  const app = isApp(target)
    ? target
    : createAvi({ startupSummary: false, ...options }).register(target);
  const { port } = await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${String(port)}`;

  const request = async (method: string, path: string, init: TestRequest = {}) => {
    const headers = new Headers(init.headers);
    let body: string | Uint8Array | undefined;
    if (init.body !== undefined) {
      if (typeof init.body === 'string' || init.body instanceof Uint8Array) {
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
    return { status: response.status, headers: response.headers, body: parsed, text };
  };

  return {
    app,
    url,
    request,
    get: (path, init) => request('GET', path, init),
    post: (path, body, init) => request('POST', path, { ...init, body }),
    put: (path, body, init) => request('PUT', path, { ...init, body }),
    patch: (path, body, init) => request('PATCH', path, { ...init, body }),
    delete: (path, init) => request('DELETE', path, init),
    close: () => app.close(),
  };
}

function isApp(value: unknown): value is AviApp {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<AviApp>).listen === 'function' &&
    typeof (value as Partial<AviApp>).register === 'function'
  );
}

function queryString(query: TestRequest['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of typeof value === 'string' ? [value] : value) params.append(key, item);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
