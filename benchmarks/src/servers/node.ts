// Hand-written node:http server with the same responses as the Avi server.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LIST, TOKEN } from '../data.js';

function json(
  res: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function readJson(req: IncomingMessage, done: (value: object) => void): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    done(JSON.parse(Buffer.concat(chunks).toString('utf8')) as object);
  });
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  const end = url.indexOf('?');
  const path = end === -1 ? url : url.slice(0, end);

  if (req.method === 'GET' && path === '/') {
    json(res, 200, { hello: 'world' });
  } else if (req.method === 'GET' && path === '/list') {
    json(res, 200, LIST);
  } else if (req.method === 'GET' && path.startsWith('/users/') && !path.includes('/', 7)) {
    json(res, 200, { id: decodeURIComponent(path.slice(7)) });
  } else if (req.method === 'POST' && path === '/echo') {
    readJson(req, (body) => {
      json(res, 200, body);
    });
  } else if (req.method === 'POST' && path === '/orders') {
    if (req.headers.authorization !== TOKEN) {
      json(res, 403, { statusCode: 403, error: 'Forbidden' });
      return;
    }
    readJson(req, (body) => {
      json(res, 201, { id: 1, ...body }, { location: '/orders/1' });
    });
  } else {
    json(res, 404, { statusCode: 404, error: 'Not Found' });
  }
});

server.listen(Number(process.argv[2] ?? 0), '127.0.0.1', () => {
  process.send?.({ port: (server.address() as AddressInfo).port });
});
process.on('disconnect', () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
});
