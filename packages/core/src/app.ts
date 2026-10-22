import { Container, type Token, type TokenType } from '@avi/di';
import { HttpServer, Router, type RouteDefinition, type ServerOptions } from '@avi/http';
import type { AddressInfo } from 'node:net';
import { joinPath } from './controller.js';
import {
  defineModule,
  toModule,
  type AviModule,
  type ModuleOptions,
  type ModuleRef,
} from './module.js';

export type AviOptions = ServerOptions;

export interface AviApp {
  /** Adds a root module: `defineModule`, an `@Module` class or inline options. Checks run in `init()`. */
  register(module: ModuleRef | ModuleOptions): this;
  /** Validates the module graph and routes, then creates all singletons. `listen()` calls it. */
  init(): Promise<void>;
  /** Starts the server. Use port `0` for a random free port. */
  listen(port: number, host?: string): Promise<AddressInfo>;
  /** Resolves a provider visible to the root modules. For tests and scripts, not app code. */
  get<K extends Token>(token: K): TokenType<K>;
  /** Stops accepting connections, waits for in-flight requests, then disposes providers. */
  close(): Promise<void>;
}

export function createAvi(options: AviOptions = {}): AviApp {
  return new Application(options);
}

export const AviFactory = {
  /** Registers `module` and runs `init()`. The returned app is ready to `listen()`. */
  async create(module: ModuleRef | ModuleOptions, options?: AviOptions): Promise<AviApp> {
    const app = createAvi(options).register(module);
    await app.init();
    return app;
  },
};

class Application implements AviApp {
  readonly #router = new Router();
  readonly #server: HttpServer;
  readonly #roots: AviModule[] = [];
  #container: Container | undefined;
  #init: Promise<void> | undefined;

  constructor(options: AviOptions) {
    this.#server = new HttpServer(this.#router, options);
  }

  register(module: ModuleRef | ModuleOptions): this {
    if (this.#init) throw new Error('Cannot register modules after init() or listen()');
    if (typeof module === 'function' && !toModule(module)) {
      throw new TypeError(`${module.name || 'This class'} is not a module: add @Module()`);
    }
    this.#roots.push(toModule(module) ?? defineModule(module as ModuleOptions));
    return this;
  }

  init(): Promise<void> {
    return (this.#init ??= this.#start());
  }

  async listen(port: number, host?: string): Promise<AddressInfo> {
    await this.init();
    return this.#server.listen(port, host);
  }

  get<K extends Token>(token: K): TokenType<K> {
    if (!this.#container) throw new Error('Call await app.init() before app.get()');
    return this.#container.get(token) as TokenType<K>;
  }

  async close(): Promise<void> {
    await this.#server.close();
    await this.#container?.dispose();
  }

  async #start(): Promise<void> {
    const container = new Container(this.#roots);
    const modules = container.modules as AviModule[];
    for (const module of modules) {
      for (const controller of module.controllers) {
        container.check(
          module,
          controller.inject,
          `${module.name} controller ${controller.prefix}`,
        );
      }
    }

    await container.init();
    try {
      const routes: RouteDefinition[] = [];
      for (const module of modules) {
        for (const controller of module.controllers) {
          const deps = controller.inject.map((token) => container.resolve(module, token));
          const base = joinPath(module.prefix, controller.prefix);
          for (const route of controller.createRoutes(deps)) {
            routes.push({ ...route, path: joinPath(base, route.path) });
          }
        }
      }
      this.#router.add(routes);
      this.#container = container;
    } catch (error) {
      await container.dispose().catch(() => undefined);
      throw error;
    }
  }
}
