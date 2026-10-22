import { Container, type Provider, type Token, type TokenType } from '@avi/di';
import {
  HttpServer,
  Router,
  compose,
  type Guard,
  type HttpMethod,
  type Middleware,
  type RouteDefinition,
  type ServerOptions,
} from '@avi/http';
import { withValidation, type RouteSchema } from '@avi/validation';
import type { AddressInfo } from 'node:net';
import { joinPath } from './controller.js';
import { checkConsumers, injectOf } from './consumers.js';
import { describeModules, firstDifference, type AppDescription } from './describe.js';
import {
  defineModule,
  toModule,
  type AviModule,
  type ModuleOptions,
  type ModuleRef,
} from './module.js';
import {
  checkRefs,
  isClass,
  type GuardClass,
  type GuardRef,
  type MiddlewareClass,
  type MiddlewareRef,
  type RouteDocs,
} from './pipeline.js';

export interface AviOptions extends ServerOptions {
  /** Runs first, for every route. */
  middleware?: readonly MiddlewareRef[];
  /** Checked first, for every route. */
  guards?: readonly GuardRef[];
  /**
   * A manifest from `describeApp()` or `avi-compile manifest`. `init()` fails if the app no longer
   * matches it, so a stale build artifact cannot ship unnoticed.
   */
  manifest?: AppDescription;
  /**
   * Providers that replace the provider for the same token anywhere in the app, for tests.
   * An override that matches no provider is an error.
   */
  overrides?: readonly Provider[];
}

export interface AviApp {
  /** Adds a root module: `defineModule`, an `@Module` class or inline options. Checks run in `init()`. */
  register(module: ModuleRef | ModuleOptions): this;
  /** Validates the module graph and routes, then creates all singletons. `listen()` calls it. */
  init(): Promise<void>;
  /** Starts the server. Use port `0` for a random free port. */
  listen(port: number, host?: string): Promise<AddressInfo>;
  /** Resolves a provider visible to the root modules. For tests and scripts, not app code. */
  get<K extends Token>(token: K): TokenType<K>;
  /** Every registered route, including runtime-created ones. Available after `init()`. */
  routes(): readonly RouteInfo[];
  /** Stops accepting connections, waits for in-flight requests, then disposes providers. */
  close(): Promise<void>;
}

export interface RouteInfo {
  readonly method: HttpMethod;
  readonly path: string;
  readonly module: string;
  readonly controller: string;
  readonly schema: RouteSchema | undefined;
  readonly openapi: RouteDocs | undefined;
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

type Resolve = (token: Token) => unknown;

class Application implements AviApp {
  readonly #router = new Router();
  readonly #server: HttpServer;
  readonly #roots: AviModule[] = [];
  readonly #middleware: readonly MiddlewareRef[];
  readonly #guards: readonly GuardRef[];
  readonly #manifest: AppDescription | undefined;
  readonly #overrides: readonly Provider[];
  #container: Container | undefined;
  #routes: readonly RouteInfo[] | undefined;
  #init: Promise<void> | undefined;

  constructor(options: AviOptions) {
    this.#server = new HttpServer(this.#router, options);
    this.#middleware = checkRefs(options.middleware, 'use', 'App middleware');
    this.#guards = checkRefs(options.guards, 'canActivate', 'App guards');
    this.#manifest = options.manifest;
    this.#overrides = options.overrides ?? [];
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

  routes(): readonly RouteInfo[] {
    if (!this.#routes) throw new Error('Call await app.init() before app.routes()');
    return this.#routes;
  }

  async close(): Promise<void> {
    await this.#server.close();
    await this.#container?.dispose();
  }

  async #start(): Promise<void> {
    const container = new Container(this.#roots, { overrides: this.#overrides });
    const modules = container.modules as AviModule[];
    checkConsumers(container);

    await container.init();
    try {
      const appScope = new Pipeline((token) => container.get(token));
      const appMiddleware = appScope.middleware(this.#middleware);
      const appGuards = appScope.guards(this.#guards);

      const routes: RouteDefinition[] = [];
      const infos: RouteInfo[] = [];
      for (const module of modules) {
        const scope = new Pipeline((token) => container.resolve(module, token));
        const moduleMiddleware = [...appMiddleware, ...scope.middleware(module.middleware)];
        const moduleGuards = [...appGuards, ...scope.guards(module.guards)];

        for (const controller of module.controllers) {
          const deps = controller.inject.map((token) => container.resolve(module, token));
          const base = joinPath(module.prefix, controller.prefix);
          const middleware = [...moduleMiddleware, ...scope.middleware(controller.middleware)];
          const guards = [...moduleGuards, ...scope.guards(controller.guards)];

          for (const route of controller.createRoutes(deps)) {
            const path = joinPath(base, route.path);
            infos.push({
              method: route.method,
              path,
              module: module.name,
              controller: controller.name,
              schema: route.schema,
              openapi: route.openapi,
            });
            routes.push({
              method: route.method,
              path,
              handler: compose(
                [...middleware, ...scope.middleware(route.middleware ?? [])],
                [...guards, ...scope.guards(route.guards ?? [])],
                route.schema ? withValidation(route.schema, route.handler) : route.handler,
              ),
            });
          }
        }
      }
      this.#router.add(routes);
      this.#routes = Object.freeze(infos);
      if (this.#manifest) {
        const difference = firstDifference(this.#manifest, describeModules(container));
        if (difference) {
          throw new Error(
            `The app does not match its manifest (first difference at ${difference}). Regenerate the manifest.`,
          );
        }
      }
      this.#container = container;
    } catch (error) {
      await container.dispose().catch(() => undefined);
      throw error;
    }
  }
}

/** Turns middleware and guard refs into functions, building each class once per scope. */
class Pipeline {
  readonly #instances = new Map<unknown, unknown>();

  constructor(private readonly resolve: Resolve) {}

  middleware(refs: readonly MiddlewareRef[]): Middleware[] {
    return refs.map((ref): Middleware => {
      if (!isClass(ref)) return ref as Middleware;
      const instance = this.#instance(ref as MiddlewareClass) as { use: Middleware };
      return (ctx, next) => instance.use(ctx, next);
    });
  }

  guards(refs: readonly GuardRef[]): Guard[] {
    return refs.map((ref): Guard => {
      if (!isClass(ref)) return ref as Guard;
      const instance = this.#instance(ref as GuardClass) as { canActivate: Guard };
      return (ctx) => instance.canActivate(ctx);
    });
  }

  #instance(cls: MiddlewareClass | GuardClass): unknown {
    let instance = this.#instances.get(cls);
    if (!instance) {
      const inject = injectOf(cls);
      if (cls.length > inject.length) {
        throw new TypeError(
          `${cls.name} takes ${String(cls.length)} constructor arguments but static inject lists ${String(inject.length)}`,
        );
      }
      const Ctor = cls as unknown as new (...args: unknown[]) => unknown;
      instance = new Ctor(...inject.map(this.resolve));
      this.#instances.set(cls, instance);
    }
    return instance;
  }
}
