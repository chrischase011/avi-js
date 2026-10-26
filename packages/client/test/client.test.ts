import {
  Controller,
  Get,
  HttpError,
  Post,
  createAvi,
  defineController,
  reply,
  route,
  sse,
  type AviApp,
  type Context,
  type MethodEndpoint,
  type RouteContext,
  type RouteEndpoint,
} from '@avijs/core';
import * as v from 'valibot';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { AviClientError, createClient, fillPath } from '../src/index.js';

const CreateUser = v.object({ name: v.pipe(v.string(), v.minLength(1)) });
const ListQuery = v.object({ page: v.optional(v.pipe(v.string(), v.transform(Number))) });
const create = { body: CreateUser } as const;
const list = { query: ListQuery } as const;

interface User {
  id: number;
  name: string;
  joined: Date;
}

@Controller('/users')
class UsersController {
  readonly #users: User[] = [{ id: 1, name: 'Shiela', joined: new Date(0) }];

  @Get('/', { schema: list })
  findAll(ctx: RouteContext<typeof list>) {
    return { page: ctx.input.query.page ?? 1, users: this.#users };
  }

  @Get('/:id')
  findOne(ctx: Context) {
    const user = this.#users.find((u) => String(u.id) === ctx.params['id']);
    if (!user) throw new HttpError(404, 'User not found');
    return user;
  }

  @Post('/', { schema: create })
  create(ctx: RouteContext<typeof create>) {
    const user = { id: this.#users.length + 1, name: ctx.input.body.name, joined: new Date(0) };
    this.#users.push(user);
    return reply(user, { status: 201 });
  }

  @Get('/events')
  events(ctx: Context) {
    return sse(ctx, function* () {
      yield 'one';
    });
  }
}

const files = defineController({
  prefix: '/files',
  routes: [
    route({ method: 'GET', path: '/*', handler: (ctx) => ctx.params['*'] }),
    route({ method: 'POST', path: '/upload', handler: async (ctx) => (await ctx.text()).length }),
  ],
});

// What `avi client` generates for this app.
interface Api {
  'GET /users': MethodEndpoint<'/users', UsersController['findAll']>;
  'GET /users/:id': MethodEndpoint<'/users/:id', UsersController['findOne']>;
  'POST /users': MethodEndpoint<'/users', UsersController['create']>;
  'GET /users/events': MethodEndpoint<'/users/events', UsersController['events']>;
  'GET /files/*': RouteEndpoint<'/files/*', typeof files, 0>;
  'POST /files/upload': RouteEndpoint<'/files/upload', typeof files, 1>;
}

let app: AviApp;
let baseUrl: string;

beforeAll(async () => {
  app = createAvi({ logger: { error: () => undefined } }).register({
    controllers: [UsersController, files],
  });
  const { port } = await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${String(port)}`;
});

afterAll(() => app.close());

describe('createClient', () => {
  it('calls routes by path with typed params, query and body', async () => {
    const api = createClient<Api>({ baseUrl });

    const list = await api.get('/users', { query: { page: '2' } });
    expectTypeOf(list).toEqualTypeOf<{
      page: number;
      users: { id: number; name: string; joined: string }[];
    }>();
    expect(list).toEqual({
      page: 2,
      users: [{ id: 1, name: 'Shiela', joined: '1970-01-01T00:00:00.000Z' }],
    });

    const one = await api.get('/users/:id', { params: { id: 1 } });
    expect(one.name).toBe('Shiela');

    const created = await api.post('/users', { body: { name: 'Ada' } });
    expectTypeOf(created.joined).toEqualTypeOf<string>();
    expect(created).toMatchObject({ id: 2, name: 'Ada' });
  });

  it('throws AviClientError with the status, error body and request id', async () => {
    const api = createClient<Api>({ baseUrl });
    const error = await api.get('/users/:id', { params: { id: 404 } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AviClientError);
    const failure = error as AviClientError;
    expect(failure.status).toBe(404);
    expect(failure.body).toMatchObject({ statusCode: 404, message: 'User not found' });
    expect(failure.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(failure.message).toBe('GET /users/:id failed with 404: User not found');

    const invalid = await api.post('/users', { body: { name: '' } }).catch((e: unknown) => e);
    expect((invalid as AviClientError).status).toBe(400);
  });

  it('encodes params, keeps wildcard slashes and sends text bodies as they are', async () => {
    const api = createClient<Api>({ baseUrl: `${baseUrl}/` });
    expect(await api.get('/files/*', { params: { '*': 'a b/c.txt' } })).toBe('a b/c.txt');
    expect(await api.post('/files/upload', { body: 'hello' })).toBe(5);
    await expect(api.get('/users/:id', { params: {} as { id: string } })).rejects.toThrow(
      'Missing path parameter "id" for /users/:id',
    );
  });

  it('never lets a param value change which route is called', async () => {
    // URLs resolve `.` and `..` segments, even encoded as %2E, so /users/../posts would be /posts.
    for (const id of ['..', '.']) {
      expect(() => fillPath('/users/:id/posts', { id })).toThrow(
        `Path parameter "id" cannot be "." or "..": ${id}`,
      );
    }
    expect(() => fillPath('/files/*', { '*': 'a/../b' })).toThrow('cannot be "." or ".."');
    // Dots inside a segment are ordinary characters.
    expect(fillPath('/users/:id/posts', { id: '...' })).toBe('/users/.../posts');
    expect(fillPath('/files/*', { '*': 'a/.b/c..d' })).toBe('/files/a/.b/c..d');

    const api = createClient<Api>({ baseUrl });
    await expect(api.get('/users/:id', { params: { id: '..' } })).rejects.toThrow(TypeError);
  });

  it('refuses a baseUrl the path would be appended to the query of', () => {
    for (const bad of ['https://api.example/v1?key=k', 'https://api.example/#x']) {
      expect(() => createClient<Api>({ baseUrl: bad })).toThrow('cannot have a query or fragment');
    }
  });

  it('refuses empty values, which would call the parent route or another host', async () => {
    // /users/ is the same route as /users: deleting "" would delete the collection.
    expect(() => fillPath('/users/:id', { id: '' })).toThrow('Path parameter "id" cannot be empty');
    // Empty wildcard parts could start the path with // (another host, for a relative baseUrl).
    for (const rest of ['/evil.example/x', 'a//b', 'a/']) {
      expect(() => fillPath('/files/*', { '*': rest })).toThrow('cannot be empty');
    }
    expect(fillPath('/files/*', { '*': '' })).toBe('/files/');
    // Names of Object.prototype are not values.
    expect(() => fillPath('/u/:constructor', {})).toThrow('Missing path parameter "constructor"');

    const relative = createClient<Api>({
      baseUrl: '',
      fetch: () => Promise.reject(new Error('sent')),
    });
    await expect(relative.get('/files/*', { params: { '*': 'evil.example' } })).rejects.toThrow(
      'sent',
    );
  });

  it('returns streams as the Response, and raw calls never throw', async () => {
    const api = createClient<Api>({ baseUrl });
    const events = await api.get('/users/events');
    expectTypeOf(events).toEqualTypeOf<Response>();
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    expect(await events.text()).toContain('data: one');

    const missing = await api.raw.get('/users/:id', { params: { id: 9 } });
    expect(missing.status).toBe(404);
    await missing.body?.cancel();
  });

  it('adds default headers, per-call headers and fetch options', async () => {
    const fetch = vi.fn((input: string, init: RequestInit) => globalThis.fetch(input, init));
    let token = 0;
    const api = createClient<Api>({
      baseUrl,
      fetch,
      headers: () => ({ authorization: `Bearer ${String(++token)}` }),
      init: { credentials: 'include' },
    });
    await api.get('/users', { headers: { 'x-trace': 't1' } });
    await api.get('/users');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${baseUrl}/users`);
    expect(init?.credentials).toBe('include');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer 1');
    expect(headers.get('x-trace')).toBe('t1');
    expect(new Headers(fetch.mock.calls[1]?.[1].headers).get('authorization')).toBe('Bearer 2');
  });

  it('passes an abort signal through', async () => {
    const api = createClient<Api>({ baseUrl });
    const controller = new AbortController();
    controller.abort();
    await expect(api.get('/users', { signal: controller.signal })).rejects.toThrow(/abort/i);
  });
});

describe('client types', () => {
  it('requires what the route needs and rejects unknown paths', () => {
    const api = createClient<Api>({ baseUrl: 'http://x' });
    // Compile-time checks only; none of these run.
    const check = () => {
      // @ts-expect-error unknown path
      void api.get('/nope');
      // @ts-expect-error params are required for /users/:id
      void api.get('/users/:id');
      // @ts-expect-error the body schema needs a name
      void api.post('/users', { body: {} });
      // @ts-expect-error there is no PUT route
      void api.put('/users');
      // Query is optional when every field is.
      void api.get('/users');
    };
    expect(check).toBeTypeOf('function');
  });
});

describe('query types', () => {
  const Filters = v.object({
    limit: v.optional(v.pipe(v.string(), v.transform(Number))),
    status: v.optional(v.picklist(['todo', 'done'])),
    tags: v.optional(v.array(v.string())),
  });
  const tasks = defineController({
    prefix: '/tasks',
    routes: [
      route({
        method: 'GET',
        path: '/',
        schema: { query: Filters },
        handler: (ctx) => ctx.input.query,
      }),
    ],
  });
  interface TasksApi {
    'GET /tasks': RouteEndpoint<'/tasks', typeof tasks, 0>;
  }

  it('takes numbers and booleans where the schema takes any string, and keeps literals strict', async () => {
    const server = createAvi({ startupSummary: false }).register({ controllers: [tasks] });
    const { port } = await server.listen(0, '127.0.0.1');
    try {
      const api = createClient<TasksApi>({ baseUrl: `http://127.0.0.1:${String(port)}` });
      expect(await api.get('/tasks', { query: { limit: 100, tags: ['a', 2, true] } })).toEqual({
        limit: 100,
        tags: ['a', '2', 'true'],
      });
      expect(await api.get('/tasks', { query: { limit: '5', status: 'done' } })).toEqual({
        limit: 5,
        status: 'done',
      });
      // @ts-expect-error status is one of the listed values
      await api.get('/tasks', { query: { status: 'later' } }).catch(() => undefined);
      // @ts-expect-error an object is not a query value
      await api.get('/tasks', { query: { limit: {} } }).catch(() => undefined);
    } finally {
      await server.close();
    }
  });
});

describe('events', () => {
  const feed = defineController({
    prefix: '/feed',
    routes: [
      route({
        method: 'GET',
        path: '/:room',
        handler: (ctx) => {
          if (ctx.headers.authorization !== 'Bearer t') throw new HttpError(401, 'Sign in first');
          return sse(ctx, function* () {
            yield 'hello';
            yield { event: 'task', id: '7', data: { room: ctx.params.room } };
            yield 'two\nlines';
          });
        },
      }),
    ],
  });
  interface FeedApi {
    'GET /feed/:room': RouteEndpoint<'/feed/:room', typeof feed, 0>;
  }

  // Serves `chunks` as a stream through the client's fetch option.
  const streaming = (chunks: string[], onCancel?: () => void) =>
    createClient<FeedApi>({
      baseUrl: 'http://test',
      fetch: () => {
        const encoder = new TextEncoder();
        let i = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            const chunk = chunks[i++];
            if (chunk === undefined) controller.close();
            else controller.enqueue(encoder.encode(chunk));
          },
          cancel: onCancel,
        });
        return Promise.resolve(
          new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
        );
      },
    });

  it('reads an sse() stream with the client headers', async () => {
    const server = createAvi({ startupSummary: false }).register({ controllers: [feed] });
    const { port } = await server.listen(0, '127.0.0.1');
    try {
      const api = createClient<FeedApi>({
        baseUrl: `http://127.0.0.1:${String(port)}`,
        headers: { authorization: 'Bearer t' },
      });
      const received = [];
      for await (const message of api.events('/feed/:room', { params: { room: 'a' } })) {
        received.push(message);
      }
      expect(received).toEqual([
        { event: 'message', data: 'hello' },
        { event: 'task', id: '7', data: '{"room":"a"}' },
        { event: 'message', id: '7', data: 'two\nlines' },
      ]);

      const anonymous = createClient<FeedApi>({ baseUrl: `http://127.0.0.1:${String(port)}` });
      const failure = await anonymous
        .events('/feed/:room', { params: { room: 'a' } })
        [Symbol.asyncIterator]()
        .next()
        .catch((e: unknown) => e);
      expect((failure as AviClientError).status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('parses the format across chunk boundaries and line endings', async () => {
    const api = streaming([
      ': a comment\r',
      '\ndata:no space\r\n\r',
      '\nevent: x\ndata\ndata:  two spaces\n\n',
      'id: 1\0x\ndata: id with a null is ignored\n\n',
      'data: never finished',
    ]);
    const received = [];
    for await (const message of api.events('/feed/:room', { params: { room: 'a' } })) {
      received.push(message);
    }
    expect(received).toEqual([
      { event: 'message', data: 'no space' },
      { event: 'x', data: '\n two spaces' },
      { event: 'message', data: 'id with a null is ignored' },
    ]);
  });

  it('cancels the stream when the loop stops, and ends quietly on abort', async () => {
    const cancel = vi.fn();
    const api = streaming(['data: 1\n\n', 'data: 2\n\n'], cancel);
    for await (const message of api.events('/feed/:room', { params: { room: 'a' } })) {
      expect(message.data).toBe('1');
      break;
    }
    expect(cancel).toHaveBeenCalled();

    const controller = new AbortController();
    const seen: string[] = [];
    const endless = createClient<FeedApi>({
      baseUrl: 'http://test',
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    });
    setTimeout(() => {
      controller.abort();
    }, 10);
    for await (const message of endless.events('/feed/:room', {
      params: { room: 'a' },
      signal: controller.signal,
    })) {
      seen.push(message.data);
    }
    expect(seen).toEqual([]);
  });
});
