import { normalizeProvider, type Provider, type ProviderSpec, type Scope } from './provider.js';
import { isToken, tokenName, type Token } from './token.js';

export interface ModuleDefinition {
  readonly name?: string;
  readonly imports?: readonly ModuleDefinition[];
  readonly providers?: readonly Provider[];
  /** Own providers, tokens re-exported from imports, or imported modules to re-export. */
  readonly exports?: readonly (Token | ModuleDefinition)[];
}

export interface ContainerOptions {
  /**
   * Providers that replace the provider for the same token wherever it is declared. Meant for
   * tests. An override that matches nothing is an error.
   */
  readonly overrides?: readonly Provider[];
  /**
   * Tokens whose values each request supplies through `requestScope()`, such as the request
   * itself. Visible in every module, as request-scoped providers.
   */
  readonly requestTokens?: readonly Token[];
  /** Singletons with a fixed value, visible in every module, such as the app itself. Never disposed. */
  readonly values?: ReadonlyMap<Token, unknown>;
}

/** Request-scoped instances for one request. */
export interface RequestScope {
  /** Like `Container.resolve`, but request-scoped providers are created once for this scope. */
  resolve(module: ModuleDefinition, token: Token): unknown;
  /** Disposes this scope's instances in reverse creation order. */
  dispose(): Promise<void>;
}

export interface ProviderDescription {
  readonly token: string;
  readonly kind: 'class' | 'value' | 'factory';
  readonly scope: Scope;
  readonly inject: readonly string[];
}

export interface ModuleDescription {
  readonly name: string;
  readonly imports: readonly string[];
  readonly providers: readonly ProviderDescription[];
  readonly exports: readonly string[];
}

interface ProviderRecord extends ProviderSpec {
  readonly module: ModuleRecord;
  links: ProviderRecord[];
  /** Request-scoped, or transient with a request-scoped dependency. Set by `#check`. */
  requestBound: boolean;
  /** Supplied per request, see `requestTokens`. */
  supplied: boolean;
  state: 'unchecked' | 'checking' | 'checked';
  instance: unknown;
  ready: Promise<void> | undefined;
}

interface ModuleRecord {
  readonly definition: ModuleDefinition;
  readonly name: string;
  readonly imports: ModuleRecord[];
  readonly own: Map<Token, ProviderRecord>;
  readonly exported: Map<Token, ProviderRecord>;
}

type Lookup = ProviderRecord | { ambiguous: string[] } | undefined;

interface ScopeState {
  readonly values: ReadonlyMap<Token, unknown>;
  readonly instances: Map<ProviderRecord, unknown>;
  readonly created: { record: ProviderRecord; value: unknown }[];
}

const REQUEST_MODULE: ModuleRecord = {
  definition: { name: 'request' },
  name: 'request',
  imports: [],
  own: new Map(),
  exported: new Map(),
};

const SUPPLIED_MODULE: ModuleRecord = {
  definition: { name: 'app' },
  name: 'app',
  imports: [],
  own: new Map(),
  exported: new Map(),
};

/**
 * Builds and validates the module graph on construction. `init()` creates every singleton,
 * `dispose()` tears them down in reverse creation order.
 */
export class Container {
  readonly #modules = new Map<ModuleDefinition, ModuleRecord>();
  readonly #roots: ModuleRecord[];
  readonly #created: ProviderRecord[] = [];
  readonly #overrides = new Map<Token, ProviderSpec>();
  readonly #overridden = new Set<Token>();
  readonly #supplied = new Map<Token, ProviderRecord>();
  #state: 'new' | 'initializing' | 'ready' | 'disposed' = 'new';

  constructor(roots: readonly ModuleDefinition[], options: ContainerOptions = {}) {
    (options.overrides ?? []).forEach((provider, i) => {
      const spec = normalizeProvider(provider, `overrides[${String(i)}]`);
      if (this.#overrides.has(spec.token)) {
        throw new Error(`${tokenName(spec.token)} is overridden twice`);
      }
      this.#overrides.set(spec.token, spec);
    });

    for (const token of options.requestTokens ?? []) {
      this.#supplied.set(token, {
        token,
        kind: 'value',
        scope: 'request',
        deps: [],
        create: () => undefined,
        dispose: undefined,
        module: REQUEST_MODULE,
        links: [],
        requestBound: true,
        supplied: true,
        state: 'checked',
        instance: undefined,
        ready: undefined,
      });
    }

    for (const [token, value] of options.values ?? []) {
      this.#supplied.set(token, {
        token,
        kind: 'value',
        scope: 'singleton',
        deps: [],
        create: () => value,
        dispose: undefined,
        module: SUPPLIED_MODULE,
        links: [],
        requestBound: false,
        supplied: false,
        state: 'checked',
        instance: value,
        ready: Promise.resolve(),
      });
    }

    this.#roots = roots.map((root, i) => this.#collect(root, [], `root module ${String(i)}`));
    for (const token of this.#overrides.keys()) {
      if (!this.#overridden.has(token)) {
        throw new Error(`The override for ${tokenName(token)} matches no provider in the app`);
      }
    }
    for (const module of this.#modules.values()) {
      for (const record of module.own.values()) this.#check(record, [tokenName(record.token)]);
    }
  }

  /** Module definitions in dependency order: imports before importers. */
  get modules(): ModuleDefinition[] {
    return [...this.#modules.keys()];
  }

  /** A plain description of the validated graph, without creating any provider. */
  describe(): ModuleDescription[] {
    return [...this.#modules.values()].map((module) => ({
      name: module.name,
      imports: module.imports.map((imported) => imported.name),
      providers: [...module.own.values()].map((record) => ({
        token: tokenName(record.token),
        kind: record.kind,
        scope: record.scope,
        inject: record.deps.map(tokenName),
      })),
      exports: [...module.exported.keys()].map(tokenName),
    }));
  }

  /** Throws if `tokens` cannot all be resolved from `module`. `label` starts the error path. */
  check(module: ModuleDefinition, tokens: readonly Token[], label: string): void {
    const record = this.#module(module);
    for (const token of tokens) {
      const target = this.#lookupOrThrow(record, token, [label]);
      this.#check(target, [label, tokenName(token)]);
    }
  }

  /** True if resolving any of `tokens` from `module` needs a request scope. */
  needsRequest(module: ModuleDefinition, tokens: readonly Token[]): boolean {
    const record = this.#module(module);
    return tokens.some((token) => this.#lookupOrThrow(record, token, []).requestBound);
  }

  /** Starts a request scope. `values` supplies the `requestTokens`. */
  requestScope(values: ReadonlyMap<Token, unknown>): RequestScope {
    this.#assertReady();
    const scope: ScopeState = { values, instances: new Map(), created: [] };
    return {
      resolve: (module, token) =>
        this.#instance(this.#lookupOrThrow(this.#module(module), token, []), scope),
      dispose: () => disposeAll(scope.created.splice(0)),
    };
  }

  async init(): Promise<void> {
    if (this.#state !== 'new') throw new Error(`Container is already ${this.#state}`);
    this.#state = 'initializing';
    try {
      for (const module of this.#modules.values()) {
        for (const record of module.own.values()) {
          if (record.scope === 'singleton') await this.#ensure(record);
          else await this.#ensureDeps(record);
        }
      }
      this.#state = 'ready';
    } catch (error) {
      await this.dispose().catch(() => undefined);
      throw error;
    }
  }

  /** Resolves `token` as seen from `module`. Transients are created on every call. */
  resolve(module: ModuleDefinition, token: Token): unknown {
    this.#assertReady();
    return this.#instance(this.#lookupOrThrow(this.#module(module), token, []));
  }

  /** Resolves `token` from what the root modules can see. Meant for tests and scripts. */
  get(token: Token): unknown {
    this.#assertReady();
    const found = new Set<ProviderRecord>();
    for (const root of this.#roots) {
      const hit = lookup(root, token);
      if (hit && 'ambiguous' in hit) {
        throw new Error(`${tokenName(token)} is exported to ${root.name} by more than one import`);
      }
      if (hit) found.add(hit);
    }
    if (found.size === 0) {
      // Supplied tokens, such as `values`, are visible everywhere.
      const supplied = this.#supplied.get(token);
      if (supplied) return this.#instance(supplied);
      throw new Error(`${tokenName(token)} is not visible to the root modules`);
    }
    if (found.size > 1)
      throw new Error(`${tokenName(token)} is provided by more than one root module`);
    return this.#instance([...found][0] as ProviderRecord);
  }

  async dispose(): Promise<void> {
    this.#state = 'disposed';
    await disposeAll(this.#created.splice(0).map((record) => ({ record, value: record.instance })));
  }

  #collect(definition: ModuleDefinition, stack: ModuleDefinition[], where: string): ModuleRecord {
    if (typeof definition !== 'object' || (definition as unknown) === null) {
      const value = definition as unknown;
      const hint = value === undefined ? ' (is there a circular import?)' : '';
      throw new TypeError(
        `Invalid module at ${where}: ${value === null ? 'null' : typeof value}${hint}`,
      );
    }
    const existing = this.#modules.get(definition);
    if (existing) return existing;

    const name = definition.name ?? '(anonymous module)';
    if (stack.includes(definition)) {
      const cycle = [...stack.slice(stack.indexOf(definition)), definition].map(moduleName);
      throw new Error(`Module import cycle: ${cycle.join(' → ')}`);
    }

    const imports = (definition.imports ?? []).map((child, i) =>
      this.#collect(child, [...stack, definition], `${name}.imports[${String(i)}]`),
    );
    const record: ModuleRecord = { definition, name, imports, own: new Map(), exported: new Map() };

    (definition.providers ?? []).forEach((provider, i) => {
      const declared = normalizeProvider(provider, `${name}.providers[${String(i)}]`);
      if (record.own.has(declared.token)) {
        throw new Error(`${tokenName(declared.token)} is provided twice in ${name}`);
      }
      const spec = this.#overrides.get(declared.token) ?? declared;
      if (spec !== declared) this.#overridden.add(declared.token);
      record.own.set(spec.token, {
        ...spec,
        module: record,
        links: [],
        requestBound: false,
        supplied: false,
        state: 'unchecked',
        instance: undefined,
        ready: undefined,
      });
    });

    for (const entry of definition.exports ?? []) exportEntry(record, entry);
    this.#modules.set(definition, record);
    return record;
  }

  #module(definition: ModuleDefinition): ModuleRecord {
    const record = this.#modules.get(definition);
    if (!record) throw new Error(`${moduleName(definition)} is not part of this application`);
    return record;
  }

  #lookupOrThrow(module: ModuleRecord, token: Token, path: string[]): ProviderRecord {
    const hit = lookup(module, token) ?? this.#supplied.get(token);
    const chain = [...path, tokenName(token)].join(' → ');
    if (!hit) {
      const imports = module.imports.map((m) => m.name).join(', ') || 'none';
      throw new Error(
        `Cannot resolve ${chain} in ${module.name}: ${tokenName(token)} is not provided by ${module.name} or exported by its imports (${imports})`,
      );
    }
    if ('ambiguous' in hit) {
      throw new Error(
        `Cannot resolve ${chain} in ${module.name}: ${tokenName(token)} is exported by more than one import (${hit.ambiguous.join(', ')})`,
      );
    }
    return hit;
  }

  /** Links dependencies and detects missing providers and cycles. */
  #check(record: ProviderRecord, path: string[]): void {
    if (record.state === 'checked') return;
    if (record.state === 'checking') {
      const start = path.indexOf(tokenName(record.token));
      throw new Error(`Dependency cycle: ${path.slice(start).join(' → ')}`);
    }
    record.state = 'checking';
    record.links = record.deps.map((token) => {
      const target = this.#lookupOrThrow(record.module, token, path);
      this.#check(target, [...path, tokenName(token)]);
      return target;
    });
    record.requestBound =
      record.scope === 'request' ||
      (record.scope === 'transient' && record.links.some((link) => link.requestBound));
    const bound = record.scope === 'singleton' && record.links.find((link) => link.requestBound);
    if (bound) {
      const name = tokenName(record.token);
      const chain = [...path, tokenName(bound.token)].join(' → ');
      throw new Error(
        `Singleton ${name} in ${record.module.name} depends on request-scoped ${tokenName(bound.token)} (${chain}). A singleton outlives the request; make ${name} request-scoped or transient.`,
      );
    }
    record.state = 'checked';
  }

  #ensure(record: ProviderRecord): Promise<void> {
    record.ready ??= (async () => {
      await this.#ensureDeps(record);
      let value = this.#create(record);
      if (record.kind === 'factory' && value instanceof Promise) {
        try {
          value = await (value as Promise<unknown>);
        } catch (error) {
          throw creationError(record, error);
        }
      }
      record.instance = value;
      if (record.kind !== 'value') this.#created.push(record);
    })();
    return record.ready;
  }

  async #ensureDeps(record: ProviderRecord): Promise<void> {
    for (const dep of record.links) {
      if (dep.scope === 'singleton') await this.#ensure(dep);
      else await this.#ensureDeps(dep);
    }
  }

  #create(record: ProviderRecord, scope?: ScopeState): unknown {
    const deps = record.links.map((dep) => this.#instance(dep, scope));
    try {
      return record.create(deps);
    } catch (error) {
      throw creationError(record, error);
    }
  }

  #instance(record: ProviderRecord, scope?: ScopeState): unknown {
    if (record.scope === 'singleton') return record.instance;
    if (record.scope === 'request') {
      if (!scope) {
        throw new Error(
          `${tokenName(record.token)} is request-scoped and can only be resolved while handling a request`,
        );
      }
      if (record.supplied) {
        if (!scope.values.has(record.token)) {
          throw new Error(`This request scope has no value for ${tokenName(record.token)}`);
        }
        return scope.values.get(record.token);
      }
      if (scope.instances.has(record)) return scope.instances.get(record);
      const value = this.#createSync(record, scope);
      scope.instances.set(record, value);
      scope.created.push({ record, value });
      return value;
    }
    return this.#createSync(record, scope);
  }

  #createSync(record: ProviderRecord, scope: ScopeState | undefined): unknown {
    const value = this.#create(record, scope);
    if (record.kind === 'factory' && value instanceof Promise) {
      (value as Promise<unknown>).catch(() => undefined);
      const kind = record.scope === 'request' ? 'Request-scoped' : 'Transient';
      throw new Error(
        `${kind} provider ${tokenName(record.token)} in ${record.module.name} returned a Promise; only singletons may be async`,
      );
    }
    return value;
  }

  #assertReady(): void {
    if (this.#state !== 'ready')
      throw new Error('The container is not initialized; call init() first');
  }
}

function lookup(module: ModuleRecord, token: Token): Lookup {
  const own = module.own.get(token);
  if (own) return own;
  const hits = new Map<ProviderRecord, string>();
  for (const imported of module.imports) {
    const hit = imported.exported.get(token);
    if (hit && !hits.has(hit)) hits.set(hit, imported.name);
  }
  if (hits.size > 1) return { ambiguous: [...hits.values()] };
  return hits.keys().next().value;
}

function exportEntry(module: ModuleRecord, entry: unknown): void {
  const imported = module.imports.find((m) => m.definition === entry);
  if (imported) {
    for (const [token, record] of imported.exported) module.exported.set(token, record);
    return;
  }
  if (!isToken(entry)) {
    throw new TypeError(
      `Invalid export in ${module.name}: expected a token or an imported module${entry === undefined ? ' (is there a circular import?)' : ''}`,
    );
  }
  const hit = lookup(module, entry);
  if (!hit) {
    throw new Error(
      `${module.name} exports ${tokenName(entry)}, which it neither provides nor imports`,
    );
  }
  if ('ambiguous' in hit) {
    throw new Error(
      `${module.name} exports ${tokenName(entry)}, which more than one import provides (${hit.ambiguous.join(', ')})`,
    );
  }
  module.exported.set(entry, hit);
}

/** Disposes in reverse order, continuing past failures. */
async function disposeAll(
  created: readonly { record: ProviderRecord; value: unknown }[],
): Promise<void> {
  const errors: unknown[] = [];
  for (const { record, value } of [...created].reverse()) {
    try {
      await disposeValue(record, value);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `Failed to dispose ${String(errors.length)} provider(s)`);
  }
}

async function disposeValue(record: ProviderRecord, instance: unknown): Promise<void> {
  if (record.dispose) {
    await record.dispose(instance);
    return;
  }
  const value = instance as Partial<AsyncDisposable & Disposable> | null | undefined;
  const asyncDispose = value?.[Symbol.asyncDispose];
  const syncDispose = value?.[Symbol.dispose];
  if (typeof asyncDispose === 'function') await asyncDispose.call(value);
  else if (typeof syncDispose === 'function') syncDispose.call(value);
}

function creationError(record: ProviderRecord, cause: unknown): Error {
  return new Error(`Failed to create ${tokenName(record.token)} in ${record.module.name}`, {
    cause,
  });
}

function moduleName(definition: ModuleDefinition): string {
  return definition.name ?? '(anonymous module)';
}
