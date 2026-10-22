import { vi } from 'vitest';
import { HttpServer, Router, type RouteDefinition, type ServerOptions } from '../src/index.js';

export interface TestServer {
  url: string;
  port: number;
  server: HttpServer;
  logger: { error: ReturnType<typeof vi.fn> };
}

export async function startServer(
  routes: readonly RouteDefinition[],
  options: ServerOptions = {},
): Promise<TestServer> {
  const router = new Router();
  router.add(routes);
  const logger = { error: vi.fn() };
  const server = new HttpServer(router, { logger, ...options });
  const { port } = await server.listen(0, '127.0.0.1');
  return { url: `http://127.0.0.1:${String(port)}`, port, server, logger };
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
