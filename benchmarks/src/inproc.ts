// Runs requests through Avi's full request path in one process, without TCP: real IncomingMessage
// and ServerResponse objects over a socket that drops what it is sent. Stable enough to A/B small
// changes on a noisy machine. With a baseline (`pnpm bench:baseline`), both builds run side by side.
import http, { IncomingMessage, ServerResponse, type RequestListener } from 'node:http';
import { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { bench, do_not_optimize, group, run, summary } from 'mitata';
import * as v from 'valibot';
import { LIST, ORDER, TOKEN, USER } from './data.js';
import { FILLER } from './routes.js';

// Capture the listener each app passes to http.createServer.
let captured: RequestListener | undefined;
const createServer = http.createServer.bind(http);
http.createServer = (...args: unknown[]) => {
  captured = args.find((a): a is RequestListener => typeof a === 'function');
  return (createServer as (...a: unknown[]) => http.Server)(...args);
};
syncBuiltinESMExports();

type Core = typeof import('@avijs/core');

async function listenerFor(core: Core): Promise<RequestListener> {
  const CreateUser = v.object({
    name: v.pipe(v.string(), v.minLength(1)),
    email: v.pipe(v.string(), v.email()),
    age: v.pipe(v.number(), v.integer(), v.minValue(0)),
  });
  const app = core
    .createAvi({ startupSummary: false, requestId: false, logger: { error: () => undefined } })
    .register({
      controllers: [
        core.defineController({
          routes: [
            { method: 'GET', path: '/', handler: () => ({ hello: 'world' }) },
            { method: 'GET', path: '/users/:id', handler: (ctx) => ({ id: ctx.params['id'] }) },
            { method: 'GET', path: '/list', handler: () => LIST },
            { method: 'POST', path: '/echo', handler: (ctx) => ctx.json() },
            {
              method: 'POST',
              path: '/orders',
              guards: [(ctx) => ctx.headers.authorization === TOKEN],
              handler: async (ctx) =>
                core.reply(
                  { id: 1, ...((await ctx.json()) as object) },
                  { status: 201, headers: { location: '/orders/1' } },
                ),
            },
            core.route({
              method: 'POST',
              path: '/validated',
              schema: { body: CreateUser },
              handler: (ctx) => ctx.input.body,
            }),
            ...FILLER.map(([method, path]) => ({ method, path, handler: () => null })),
          ],
        }),
      ],
    });
  captured = undefined;
  await app.listen(0, '127.0.0.1');
  const listener = captured as RequestListener | undefined;
  // The app stays open (a closed app no longer serves requests); the process exits at the end.
  if (!listener) throw new Error('Could not capture the request listener');
  return listener;
}

class NullSocket extends Duplex {
  remoteAddress = '127.0.0.1';
  override _read(): void {
    // Requests push their own data.
  }
  override _write(_chunk: unknown, _encoding: string, done: () => void): void {
    done();
  }
}

/** Sends one request through `listener` and resolves when the response is finished. */
function request(
  listener: RequestListener,
  method: string,
  url: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<number> {
  const socket = new NullSocket();
  const req = new IncomingMessage(socket as never);
  req.method = method;
  req.url = url;
  req.headers = body
    ? { 'content-type': 'application/json', 'content-length': String(body.length), ...headers }
    : { ...headers };
  if (body) req.push(Buffer.from(body));
  req.push(null);
  // As the HTTP parser does once the whole request has arrived.
  req.complete = true;
  const res = new ServerResponse(req);
  res.assignSocket(socket as never);
  return new Promise((resolve) => {
    res.once('finish', () => {
      resolve(res.statusCode);
    });
    listener(req, res);
  });
}

const CASES: [string, string, string, string?, Record<string, string>?][] = [
  ['hello', 'GET', '/'],
  ['param', 'GET', '/users/123'],
  ['list', 'GET', '/list'],
  ['echo', 'POST', '/echo', USER],
  ['orders', 'POST', '/orders', ORDER, { authorization: TOKEN }],
  ['validated', 'POST', '/validated', USER],
];

const builds: [string, RequestListener][] = [
  ['current', await listenerFor(await import('@avijs/core'))],
];
const baseline = new URL(
  '../results/baseline/node_modules/@avijs/core/dist/index.js',
  import.meta.url,
);
if (existsSync(fileURLToPath(baseline))) {
  builds.unshift(['baseline', await listenerFor((await import(baseline.href)) as Core)]);
}

for (const [name, listener] of builds) {
  for (const [label, method, url, body, headers] of CASES) {
    const status = await request(listener, method, url, body, headers);
    if (status >= 300) throw new Error(`${name} ${label}: status ${String(status)}`);
  }
}

console.log(
  `Full request path in one process, Node ${process.version}: ${builds.map((b) => b[0]).join(' vs ')}\n`,
);
const only = process.env['BENCH_CASES']?.split(',');
for (const [label, method, url, body, headers] of CASES.filter(
  (c) => !only || only.includes(c[0]),
)) {
  group(label, () => {
    summary(() => {
      for (const [name, listener] of builds) {
        bench(name, async () => {
          do_not_optimize(await request(listener, method, url, body, headers));
        });
      }
    });
  });
}
await run();
process.exit(0);
