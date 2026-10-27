import path from 'node:path';
import { HTTP_METHODS } from '@avijs/core';
import ts from 'typescript';
import { readProgram, unwrap, type Diagnostic } from './check.js';

export interface ClientRoute {
  readonly method: string;
  readonly path: string;
  /** The type the generated `Api` gives this route. */
  readonly type: string;
}

export interface GeneratedClient {
  /** The generated file's contents. */
  readonly source: string;
  readonly routes: readonly ClientRoute[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface GenerateClientOptions {
  /** Path to tsconfig.json. */
  readonly project: string;
  /** Where the file will be written; imports are relative to it. */
  readonly out: string;
  /** `file.ts#Export` of the root module. Default: found from `AviFactory.create` or `register`. */
  readonly root?: string;
}

const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options']);

/**
 * Reads an app's modules and controllers statically and generates the `Api` type for
 * `@avijs/client`. The type references the app's own classes and controllers, so it stays exact
 * and only changes when routes do.
 */
export function generateClient(options: GenerateClientOptions): GeneratedClient {
  const { program, roots } = readProgram(options.project);
  return generateFrom(program, roots, options);
}

/** `generateClient` on a program that is already built, such as the watcher's. */
export function generateFrom(
  program: ts.Program,
  roots: ReadonlySet<string>,
  options: Pick<GenerateClientOptions, 'out' | 'root'>,
): GeneratedClient {
  const out = path.resolve(options.out);
  const generator = new Generator(program.getTypeChecker(), roots, out);

  const appRoots = options.root
    ? generator.namedRoot(program, options.root)
    : generator.findRoots(program);
  for (const root of appRoots) generator.module(root);

  return generator.finish();
}

/**
 * Formatters may rewrap a generated file; only the content counts. Whitespace and semicolons
 * outside strings, and trailing commas, are what formatters change; other commas are content.
 */
export const sameContent = (a: string, b: string): boolean => squash(a) === squash(b);
const squash = (text: string) =>
  text
    .replace(/'[^'\n]*'|"[^"\n]*"|[\s;]+/g, (match) => (/^['"]/.test(match) ? match : ''))
    .replace(/,(?=[\])}])/g, '');

interface Found {
  readonly method: string;
  readonly path: string;
  readonly type: string;
}

class Generator {
  readonly #routes = new Map<string, Found>();
  readonly #diagnostics: Diagnostic[] = [];
  readonly #imports = new Map<string, { name: string; file: string; alias: string }>();
  readonly #visited = new Set<ts.Node>();

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly roots: ReadonlySet<string>,
    private readonly out: string,
  ) {}

  /** Module expressions passed to `AviFactory.create` or `app.register` outside tests. */
  findRoots(program: ts.Program): ts.Expression[] {
    const found: ts.Expression[] = [];
    let first: ts.SourceFile | undefined;
    for (const source of program.getSourceFiles()) {
      if (!this.#inProject(source) || /\.(test|spec)\.[cm]?tsx?$/.test(source.fileName)) continue;
      first ??= source;
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const name = node.expression.name.text;
          const target = node.expression.expression;
          const arg = node.arguments[0];
          if (arg && name === 'create' && this.#symbolName(target) === 'AviFactory') {
            found.push(arg);
          } else if (arg && name === 'register' && this.#typeName(target) === 'AviApp') {
            found.push(arg);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    if (found.length === 0) {
      this.#report(
        first,
        undefined,
        'error',
        'AVI101',
        'No app found: pass --root file.ts#AppModule, or call AviFactory.create or app.register',
      );
    }
    return found;
  }

  namedRoot(program: ts.Program, root: string): ts.Expression[] {
    const [file = '', name = 'AppModule'] = root.split('#');
    const source = program.getSourceFile(path.resolve(file));
    const symbol = source && this.checker.getSymbolAtLocation(source);
    const exported = symbol && this.checker.getExportsOfModule(symbol).find((s) => s.name === name);
    const declaration = exported && this.#declaration(exported);
    if (!declaration) {
      this.#report(source, undefined, 'error', 'AVI101', `Cannot find export ${name} in ${file}`);
      return [];
    }
    const expression = ts.isVariableDeclaration(declaration)
      ? declaration.initializer
      : ts.isClassDeclaration(declaration) && declaration.name
        ? declaration.name
        : undefined;
    return expression ? [expression] : [];
  }

  /** Walks a module: `@Module` class, `defineModule(...)`, or a module options object. */
  module(expression: ts.Expression): void {
    const options = this.#moduleOptions(expression);
    if (!options || this.#visited.has(options)) return;
    this.#visited.add(options);

    const prefix = this.#stringProperty(options, 'prefix') ?? '/';
    for (const ref of this.#arrayProperty(options, 'imports')) this.module(ref);
    for (const ref of this.#arrayProperty(options, 'controllers')) this.#controller(ref, prefix);
  }

  finish(): GeneratedClient {
    const routes = [...this.#routes.values()].sort((a, b) =>
      a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
    );
    const used = new Set(routes.map((r) => (r.type.startsWith('Method') ? 'Method' : 'Route')));
    const helpers = [
      used.has('Method') && 'MethodEndpoint',
      used.has('Route') && 'RouteEndpoint',
    ].filter(Boolean);
    const imports = [...this.#imports.values()]
      .sort((a, b) => a.file.localeCompare(b.file) || a.alias.localeCompare(b.alias))
      .map(({ name, file, alias }) => {
        const named = name === alias ? name : `${name} as ${alias}`;
        return `import type { ${named} } from ${quote(this.#specifier(file))};`;
      });

    const lines = [
      '// Generated by `avi client`; `avi dev` keeps it up to date. Do not edit.',
      ...(helpers.length > 0 ? [`import type { ${helpers.join(', ')} } from '@avijs/core';`] : []),
      ...imports,
      '',
      'export interface Api {',
      ...routes.map((r) => `  ${quote(`${r.method} ${r.path}`)}: ${r.type};`),
      '}',
      '',
    ];
    const diagnostics = this.#diagnostics.sort((a, b) =>
      a.file === b.file ? a.line - b.line || a.column - b.column : a.file.localeCompare(b.file),
    );
    return { source: lines.join('\n'), routes, diagnostics };
  }

  #moduleOptions(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
    const node = unwrap(expression);
    if (!node) return undefined;
    if (ts.isObjectLiteralExpression(node)) return node;
    if (ts.isCallExpression(node) && this.#symbolName(node.expression) === 'defineModule') {
      const arg = unwrap(node.arguments[0]);
      return arg && ts.isObjectLiteralExpression(arg) ? arg : undefined;
    }
    if (ts.isCallExpression(node)) {
      // A library's module factory, such as OpenApiModule.forRoot, has no app routes either.
      const callee = this.#declarationOf(node.expression);
      if (callee && !this.#inProject(callee.getSourceFile())) return undefined;
    }
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const declaration = this.#declarationOf(node);
      // Modules from libraries, such as a config token's module, have no app routes.
      if (!declaration || !this.#inProject(declaration.getSourceFile())) return undefined;
      if (ts.isClassDeclaration(declaration)) {
        const options = this.#decoratorArgs(declaration, (name) => name === 'Module')?.[0];
        const object = unwrap(options);
        if (object && ts.isObjectLiteralExpression(object)) return object;
        if (!options) return undefined;
      } else if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return this.#moduleOptions(declaration.initializer);
      }
    }
    this.#report(
      node.getSourceFile(),
      node,
      'warning',
      'AVI104',
      `Cannot read module ${brief(node)} statically; its routes are left out`,
    );
    return undefined;
  }

  #controller(expression: ts.Expression, modulePrefix: string): void {
    const node = unwrap(expression);
    if (!node) return;
    const declaration =
      ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)
        ? this.#declarationOf(node)
        : undefined;

    if (declaration && ts.isClassDeclaration(declaration) && declaration.name) {
      this.#classController(declaration, declaration.name.text, modulePrefix);
      return;
    }
    const call =
      declaration && ts.isVariableDeclaration(declaration) ? unwrap(declaration.initializer) : node;
    if (
      call &&
      ts.isCallExpression(call) &&
      this.#symbolName(call.expression) === 'defineController'
    ) {
      if (!declaration || !ts.isVariableDeclaration(declaration)) {
        this.#report(
          node.getSourceFile(),
          node,
          'warning',
          'AVI102',
          'Move this controller into an exported const so the client can reference it',
        );
        return;
      }
      this.#definedController(declaration, call, modulePrefix);
      return;
    }
    this.#report(
      node.getSourceFile(),
      node,
      'warning',
      'AVI103',
      `Cannot read controller ${node.getText()} statically; its routes are left out`,
    );
  }

  #classController(node: ts.ClassDeclaration, name: string, modulePrefix: string): void {
    const args = this.#decoratorArgs(node, (n) => n === 'Controller');
    if (!args) return;
    const prefix = args[0] ? this.#literal(args[0]) : '/';
    if (prefix === undefined) return;
    const alias = this.#import(node, name);
    if (!alias) return;
    const base = joinPath(modulePrefix, prefix);

    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
      for (const decorator of ts.getDecorators(member) ?? []) {
        const call = decorator.expression;
        if (!ts.isCallExpression(call)) continue;
        const method = this.#symbolName(call.expression);
        if (!method || !ROUTE_DECORATORS.has(method)) continue;
        const routePath = call.arguments[0] ? this.#literal(call.arguments[0]) : '';
        if (routePath === undefined) continue;
        this.#checkSchemaVisible(call, member);
        const full = joinPath(base, routePath);
        this.#add(
          method.toUpperCase(),
          full,
          `MethodEndpoint<${quote(full)}, ${alias}['${member.name.text}']>`,
          call,
        );
      }
    }
  }

  #definedController(
    declaration: ts.VariableDeclaration,
    call: ts.CallExpression,
    modulePrefix: string,
  ): void {
    const options = unwrap(call.arguments[0]);
    if (!options || !ts.isObjectLiteralExpression(options)) {
      this.#dynamic(call, 'its options are not an object literal');
      return;
    }
    const prefix = this.#stringProperty(options, 'prefix') ?? '/';
    const routes = this.#routeList(options);
    if (!routes || !ts.isIdentifier(declaration.name)) return;
    const alias = this.#import(declaration, declaration.name.text);
    if (!alias) return;
    const base = joinPath(modulePrefix, prefix);

    routes.elements.forEach((element, index) => {
      let object = unwrap(element);
      if (
        object &&
        ts.isCallExpression(object) &&
        this.#symbolName(object.expression) === 'route'
      ) {
        object = unwrap(object.arguments[0]);
      }
      if (!object || !ts.isObjectLiteralExpression(object)) {
        this.#dynamic(element, 'this route is not an object literal or route({...})');
        return;
      }
      const method = this.#stringProperty(object, 'method');
      const routePath = this.#stringProperty(object, 'path') ?? '';
      if (method === undefined) return;
      const full = joinPath(base, routePath);
      this.#add(
        method,
        full,
        `RouteEndpoint<${quote(full)}, typeof ${alias}, ${String(index)}>`,
        element,
      );
    });
  }

  /** The routes array: a literal, or a factory whose body returns one. */
  #routeList(options: ts.ObjectLiteralExpression): ts.ArrayLiteralExpression | undefined {
    const value = unwrap(this.#property(options, 'routes'));
    let list: ts.Expression | undefined = value;
    if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
      if (ts.isBlock(value.body)) {
        const returns = value.body.statements.filter(ts.isReturnStatement);
        list = returns.length === 1 ? returns[0]?.expression : undefined;
      } else {
        list = value.body;
      }
      list = unwrap(list);
    }
    if (!list || !ts.isArrayLiteralExpression(list) || list.elements.some(ts.isSpreadElement)) {
      this.#dynamic(value ?? options, 'its routes are not a literal array');
      return undefined;
    }
    return list;
  }

  /** Warns when a decorator schema cannot reach the client because ctx is not a RouteContext. */
  #checkSchemaVisible(call: ts.CallExpression, method: ts.MethodDeclaration): void {
    const options = unwrap(call.arguments[1]);
    const schema =
      options && ts.isObjectLiteralExpression(options) && this.#property(options, 'schema');
    if (!schema) return;
    // The response type comes from the handler anyway; only inputs need the schema.
    const fields = this.checker.getTypeAtLocation(schema);
    if (!['params', 'query', 'body'].some((name) => fields.getProperty(name))) return;
    const param = method.parameters[0];
    const type = param && this.checker.getTypeAtLocation(param);
    if (type?.getProperty('~schema')) return;
    this.#report(
      method.getSourceFile(),
      method.name,
      'warning',
      'AVI105',
      `Type ctx as RouteContext<typeof schema> so the client sees the schema of ${method.name.getText()}`,
    );
  }

  #add(method: string, full: string, type: string, at: ts.Node): void {
    if (!(HTTP_METHODS as readonly string[]).includes(method)) {
      this.#report(at.getSourceFile(), at, 'warning', 'AVI107', `${method} is not an HTTP method`);
      return;
    }
    const key = `${method} ${full}`;
    if (this.#routes.has(key)) {
      this.#report(at.getSourceFile(), at, 'warning', 'AVI106', `Duplicate route ${key}`);
      return;
    }
    this.#routes.set(key, { method, path: full, type });
  }

  /** Imports a declaration's name into the generated file, or reports why it cannot. */
  #import(node: ts.ClassDeclaration | ts.VariableDeclaration, name: string): string | undefined {
    const source = node.getSourceFile();
    const symbol = this.checker.getSymbolAtLocation(source);
    const exported =
      symbol &&
      this.checker
        .getExportsOfModule(symbol)
        .some((s) => s.name === name && this.#declaration(s) === node);
    if (!exported) {
      this.#report(
        source,
        node,
        'warning',
        'AVI102',
        `Export ${name} so the client can reference it; its routes are left out`,
      );
      return undefined;
    }
    const key = `${source.fileName}#${name}`;
    const existing = this.#imports.get(key);
    if (existing) return existing.alias;
    const taken = new Set([...this.#imports.values()].map((i) => i.alias));
    let alias = name;
    for (let n = 2; taken.has(alias); n++) alias = `${name}_${String(n)}`;
    this.#imports.set(key, { name, file: source.fileName, alias });
    return alias;
  }

  #specifier(file: string): string {
    let relative = path.relative(path.dirname(this.out), file).split(path.sep).join('/');
    if (!relative.startsWith('.')) relative = `./${relative}`;
    return relative.replace(/\.(m|c)?tsx?$/, (_, kind: string | undefined) => `.${kind ?? ''}js`);
  }

  #decoratorArgs(
    node: ts.ClassDeclaration,
    match: (name: string) => boolean,
  ): readonly ts.Expression[] | undefined {
    for (const decorator of ts.getDecorators(node) ?? []) {
      const call = decorator.expression;
      if (ts.isCallExpression(call)) {
        const name = this.#symbolName(call.expression);
        if (name && match(name)) return call.arguments;
      }
    }
    return undefined;
  }

  #property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
    for (const property of object.properties) {
      if (ts.isPropertyAssignment(property) && property.name.getText() === name) {
        return property.initializer;
      }
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) {
        return property.name;
      }
    }
    return undefined;
  }

  #stringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
    const value = this.#property(object, name);
    return value ? this.#literal(value) : undefined;
  }

  #arrayProperty(object: ts.ObjectLiteralExpression, name: string): readonly ts.Expression[] {
    const value = this.#property(object, name);
    if (!value) return [];
    const list = this.#resolveValue(value);
    if (!list || !ts.isArrayLiteralExpression(list)) {
      this.#dynamic(value, `${name} is not a literal array`);
      return [];
    }
    return list.elements.filter((element) => {
      if (!ts.isSpreadElement(element)) return true;
      this.#dynamic(element, `spreads in ${name} cannot be followed`);
      return false;
    });
  }

  /** A string literal, directly or through a const. */
  #literal(expression: ts.Expression): string | undefined {
    const value = this.#resolveValue(expression);
    if (value && ts.isStringLiteralLike(value)) return value.text;
    this.#dynamic(expression, `${expression.getText()} is not a string literal`);
    return undefined;
  }

  /** Follows a const identifier to its initializer. */
  #resolveValue(expression: ts.Expression): ts.Expression | undefined {
    const node = unwrap(expression);
    if (node && ts.isIdentifier(node)) {
      const declaration = this.#declarationOf(node);
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0
      ) {
        return unwrap(declaration.initializer);
      }
    }
    return node;
  }

  #dynamic(at: ts.Node, why: string): void {
    this.#report(at.getSourceFile(), at, 'warning', 'AVI103', `Cannot read routes: ${why}`);
  }

  #declarationOf(node: ts.Expression): ts.Declaration | undefined {
    const symbol = this.checker.getSymbolAtLocation(node);
    return symbol && this.#declaration(symbol);
  }

  #declaration(symbol: ts.Symbol): ts.Declaration | undefined {
    const target =
      symbol.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol;
    return target.valueDeclaration ?? target.declarations?.[0];
  }

  #symbolName(node: ts.Expression): string | undefined {
    const symbol = this.checker.getSymbolAtLocation(node);
    if (!symbol) return undefined;
    const target =
      symbol.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol;
    return target.name;
  }

  #typeName(node: ts.Expression): string | undefined {
    const type = this.checker.getTypeAtLocation(node);
    return (type.aliasSymbol ?? type.getSymbol())?.name;
  }

  #inProject(source: ts.SourceFile): boolean {
    return !source.isDeclarationFile && this.roots.has(path.resolve(source.fileName));
  }

  #report(
    source: ts.SourceFile | undefined,
    at: ts.Node | undefined,
    severity: Diagnostic['severity'],
    code: string,
    message: string,
  ): void {
    const position =
      source && at ? source.getLineAndCharacterOfPosition(at.getStart(source)) : undefined;
    this.#diagnostics.push({
      file: source?.fileName ?? '',
      line: (position?.line ?? 0) + 1,
      column: (position?.character ?? 0) + 1,
      severity,
      code,
      message,
    });
  }
}

/** A single-quoted TypeScript string literal for any text, so paths cannot break the file. */
function quote(text: string): string {
  return `'${text.replace(/[\\'\n\r\u2028\u2029]/g, (c) => ESCAPES[c] ?? c)}'`;
}

const ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

// Same as `joinPath` in @avijs/core.
function joinPath(prefix: string, routePath: string): string {
  const joined = `${prefix}/${routePath}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}

/** A call as `name(...)`, anything else on one line, for messages. */
function brief(node: ts.Node): string {
  if (ts.isCallExpression(node)) return `${node.expression.getText()}(...)`;
  const text = node.getText().replace(/\s+/g, ' ');
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
