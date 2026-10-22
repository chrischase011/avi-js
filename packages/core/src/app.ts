import { HttpServer, Router, type ServerOptions } from '@avi/http';
import type { AddressInfo } from 'node:net';
import { joinPath, type ControllerDefinition } from './controller.js';

export type AviOptions = ServerOptions;

export interface ModuleDefinition {
  controllers?: readonly ControllerDefinition[];
}

export interface AviApp {
  /** Adds controllers. All of a call's routes are added, or none. */
  register(definition: ModuleDefinition): this;
  /** Starts the server. Use port `0` for a random free port. */
  listen(port: number, host?: string): Promise<AddressInfo>;
  /** Stops accepting connections and waits for in-flight requests. */
  close(): Promise<void>;
}

export function createAvi(options: AviOptions = {}): AviApp {
  return new Application(options);
}

class Application implements AviApp {
  readonly #router = new Router();
  readonly #server: HttpServer;
  #started = false;

  constructor(options: AviOptions) {
    this.#server = new HttpServer(this.#router, options);
  }

  register(definition: ModuleDefinition): this {
    if (this.#started) throw new Error('Cannot register controllers after listen()');
    const routes = (definition.controllers ?? []).flatMap((controller) =>
      controller.routes.map((route) => ({
        ...route,
        path: joinPath(controller.prefix, route.path),
      })),
    );
    this.#router.add(routes);
    return this;
  }

  listen(port: number, host?: string): Promise<AddressInfo> {
    this.#started = true;
    return this.#server.listen(port, host);
  }

  close(): Promise<void> {
    return this.#server.close();
  }
}
