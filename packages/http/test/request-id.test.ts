import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  jsonLogger,
  logRequests,
  reply,
  type ResponseInfo,
  type RouteDefinition,
  type ServerOptions,
} from '../src/index.js';
import { startServer, type TestServer } from './helpers.js';

let current: TestServer | undefined;

afterEach(async () => {
  await current?.server.close();
  current = undefined;
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const routes: RouteDefinition[] = [
  { method: 'GET', path: '/id', handler: (ctx) => ctx.id },
  { method: 'POST', path: '/id', handler: () => 'posted' },
  {
    method: 'GET',
    path: '/slow',
    handler: async (ctx) => {
      const before = ctx.id;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
      return before === ctx.id ? ctx.id : 'changed';
    },
  },
  {
    method: 'GET',
    path: '/fail',
    handler: () => {
      throw new Error('broken');
    },
  },
  { method: 'GET', path: '/teapot', handler: () => Promise.reject(new HttpError(418)) },
  { method: 'GET', path: '/reply', handler: () => reply('x', { headers: { 'x-extra': '1' } }) },
  { method: 'GET', path: '/stream', handler: () => Readable.from(['a', 'b']) },
];

async function start(options: ServerOptions = {}) {
  current = await startServer(routes, options);
  return current;
}

describe('request ids', () => {
  it('generates an id, gives it to the handler and sends it back', async () => {
    const { url } = await start();
    const res = await fetch(`${url}/id`);
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(UUID);
    expect(await res.text()).toBe(id);
  });

  it('reuses a valid incoming id and replaces malformed ones', async () => {
    const { url } = await start();
    const send = async (value: string) =>
      (await fetch(`${url}/id`, { headers: { 'x-request-id': value } })).text();

    expect(await send('trace-42')).toBe('trace-42');
    expect(await send('a'.repeat(128))).toBe('a'.repeat(128));
    expect(await send('a'.repeat(129))).toMatch(UUID);
    expect(await send('has space')).toMatch(UUID);
    expect(await send('naïve')).toMatch(UUID);
  });

  it('can ignore incoming ids and use another header', async () => {
    const { url } = await start({ requestId: { header: 'X-Trace-Id', trustIncoming: false } });
    const res = await fetch(`${url}/id`, { headers: { 'x-trace-id': 'from-client' } });
    const id = res.headers.get('x-trace-id');
    expect(id).toMatch(UUID);
    expect(await res.text()).toBe(id);
    expect(res.headers.get('x-request-id')).toBeNull();
  });

  it('sends the id on every kind of response', async () => {
    const { url } = await start();
    const requests: [string, RequestInit?][] = [
      ['/missing'],
      ['/id', { method: 'DELETE' }],
      ['/id', { method: 'OPTIONS' }],
      ['/fail'],
      ['/teapot'],
      ['/reply'],
      ['/stream'],
    ];
    for (const [path, init] of requests) {
      const res = await fetch(`${url}${path}`, init);
      await res.arrayBuffer();
      expect(res.headers.get('x-request-id'), `${path} ${init?.method ?? 'GET'}`).toMatch(UUID);
    }
  });

  it('keeps ids separate across concurrent requests', async () => {
    const { url } = await start();
    const results = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const res = await fetch(`${url}/slow`);
        return { header: res.headers.get('x-request-id'), body: await res.text() };
      }),
    );
    for (const { header, body } of results) expect(body).toBe(header);
    expect(new Set(results.map((r) => r.body)).size).toBe(50);
  });

  it('can be turned off, leaving ctx.id available on demand', async () => {
    const { url } = await start({ requestId: false });
    const res = await fetch(`${url}/id`, { headers: { 'x-request-id': 'ignored' } });
    expect(res.headers.get('x-request-id')).toBeNull();
    expect(await res.text()).toMatch(UUID);
  });

  it('passes the id to error logs and onResponse', async () => {
    const seen: ResponseInfo[] = [];
    const { url, logger } = await start({
      onResponse: (info) => {
        seen.push(info);
      },
    });
    const res = await fetch(`${url}/fail`, { headers: { 'x-request-id': 'req-1' } });
    expect(res.status).toBe(500);
    await vi.waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Request failed: GET /fail',
      expect.objectContaining({ message: 'broken' }),
      { requestId: 'req-1', method: 'GET', path: '/fail' },
    );
    expect(seen[0]).toMatchObject({ id: 'req-1', method: 'GET', path: '/fail', status: 500 });
  });

  it('rejects an invalid header name', async () => {
    await expect(start({ requestId: { header: 'bad header' } })).rejects.toThrow();
  });
});

describe('jsonLogger', () => {
  it('writes one JSON object per line with fields and errors', () => {
    const lines: string[] = [];
    const logger = jsonLogger({ write: (line) => lines.push(line) });
    logger.info('started', { port: 3000 });
    logger.error('Request failed: GET /', new Error('outer', { cause: new Error('inner') }), {
      requestId: 'r1',
    });

    const [info, error] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(info).toMatchObject({ level: 'info', msg: 'started', port: 3000 });
    expect(info?.['time']).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(error).toMatchObject({
      level: 'error',
      msg: 'Request failed: GET /',
      requestId: 'r1',
      error: { name: 'Error', message: 'outer', cause: { message: 'inner' } },
    });
  });

  it('honours the level and keeps its own keys over fields', () => {
    const lines: string[] = [];
    const logger = jsonLogger({ level: 'warn', write: (line) => lines.push(line) });
    logger.info('hidden');
    logger.warn('shown', { msg: 'not this', level: 'not this' });
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 'warn', msg: 'shown' }),
    ]);
  });

  it('still logs when fields cannot be serialized', () => {
    const lines: string[] = [];
    const logger = jsonLogger({ write: (line) => lines.push(line) });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    logger.info('odd', { circular });
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      msg: 'odd',
      logError: 'Log fields could not be serialized',
    });
  });
});

describe('logRequests', () => {
  it('logs each response, warning on 5xx, and can skip some', async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const { url } = await start({
      onResponse: logRequests(logger, { skip: (info) => info.path === '/reply' }),
    });
    await (await fetch(`${url}/id`, { headers: { 'x-request-id': 'ok-1' } })).text();
    await (await fetch(`${url}/fail`)).text();
    await (await fetch(`${url}/reply`)).text();

    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
    expect(logger.info).toHaveBeenCalledWith(
      'GET /id 200',
      expect.objectContaining({ requestId: 'ok-1', route: '/id', status: 200, aborted: false }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'GET /fail 500',
      expect.objectContaining({ status: 500 }),
    );
  });
});
