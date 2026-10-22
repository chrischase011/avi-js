// Hand-written node:http server with the same two responses as the Avi server.
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  const end = url.indexOf('?');
  const path = end === -1 ? url : url.slice(0, end);

  if (req.method === 'GET' && path === '/') {
    json(res, 200, { hello: 'world' });
  } else if (req.method === 'GET' && path.startsWith('/users/') && !path.includes('/', 7)) {
    json(res, 200, { id: decodeURIComponent(path.slice(7)) });
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
