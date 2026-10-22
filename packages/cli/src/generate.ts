import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ts from 'typescript';

type Kind = 'module' | 'controller' | 'service' | 'resource';
type Layout = 'modular' | 'minimal';

const KINDS: Record<string, Kind> = {
  module: 'module',
  mo: 'module',
  controller: 'controller',
  co: 'controller',
  service: 'service',
  s: 'service',
  resource: 'resource',
  res: 'resource',
};
const SEGMENT = /^[a-z][a-z0-9-]*$/;

export const GENERATE_USAGE = `  avi generate <module|controller|service|resource> <path> [--root .] [--dry-run]
      Create a module, controller or service and register it. Short: avi g co admin/posts.
      Modular projects get src/modules/<path>/<name>.<kind>.ts, registered in the nearest
      module; minimal projects get src/routes/<path>.ts or src/services/<path>.ts, registered
      in src/app.ts. A resource (avi g res posts) creates all of them with CRUD routes.`;

interface Names {
  /** kebab-case file name, e.g. `user-profile`. */
  readonly file: string;
  /** PascalCase, e.g. `UserProfile`. */
  readonly pascal: string;
  /** camelCase, e.g. `userProfile`. */
  readonly camel: string;
}

/** Files to write, keyed by absolute path. Reads fall back to disk. */
class Plan {
  readonly #files = new Map<string, { content: string; created: boolean }>();
  readonly notes: string[] = [];

  exists(file: string): boolean {
    return this.#files.has(file) || existsSync(file);
  }

  async read(file: string): Promise<string> {
    return this.#files.get(file)?.content ?? (await readFile(file, 'utf8'));
  }

  create(file: string, content: string): void {
    if (this.exists(file)) throw new GenerateError(`${file} already exists`);
    this.#files.set(file, { content, created: true });
  }

  update(file: string, content: string): void {
    const existing = this.#files.get(file);
    this.#files.set(file, { content, created: existing?.created ?? false });
  }

  async apply(root: string, dryRun: boolean): Promise<void> {
    for (const [file, { content, created }] of this.#files) {
      console.log(
        `${created ? 'CREATE' : 'UPDATE'} ${path.relative(root, file).replaceAll('\\', '/')}`,
      );
      if (dryRun) continue;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    for (const note of this.notes) console.log(note);
  }
}

class GenerateError extends Error {}

export async function generate(args: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      root: { type: 'string', default: '.' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const [kindArg, target] = positionals;
  const kind = kindArg === undefined ? undefined : KINDS[kindArg];
  if (!kind || !target) {
    console.error(`Usage:\n${GENERATE_USAGE}`);
    return 2;
  }
  const segments = target.split('/').filter(Boolean);
  const bad = segments.find((segment) => !SEGMENT.test(segment));
  if (segments.length === 0 || bad !== undefined) {
    console.error(
      `Invalid path "${target}": use lowercase names with letters, digits and "-", separated by "/"`,
    );
    return 2;
  }

  const root = path.resolve(values.root);
  const src = path.join(root, 'src');
  const layout: Layout | undefined = existsSync(path.join(src, 'app.module.ts'))
    ? 'modular'
    : existsSync(path.join(src, 'app.ts'))
      ? 'minimal'
      : undefined;
  if (!layout) {
    console.error(
      `No src/app.module.ts or src/app.ts in ${root}. Run avi generate in an Avi.js project, or pass --root.`,
    );
    return 1;
  }

  const names = toNames(segments.at(-1) as string);
  const dirs = segments.slice(0, -1);
  const plan = new Plan();
  try {
    if (layout === 'modular') await modular(plan, src, kind, dirs, names);
    else await minimal(plan, src, kind, dirs, names);
  } catch (error) {
    if (!(error instanceof GenerateError)) throw error;
    console.error(error.message);
    return 1;
  }
  await plan.apply(root, values['dry-run']);
  return 0;
}

async function modular(
  plan: Plan,
  src: string,
  kind: Kind,
  dirs: readonly string[],
  names: Names,
): Promise<void> {
  const folder = path.join(src, 'modules', ...dirs, names.file);

  if (kind === 'resource') {
    const module = path.join(folder, `${names.file}.module.ts`);
    plan.create(module, resourceModule(names));
    plan.create(path.join(folder, `${names.file}.service.ts`), crudService(names, true));
    plan.create(path.join(folder, `${names.file}.controller.ts`), crudController(names));
    const parent = nearestModule(plan, src, path.dirname(folder));
    await register(plan, parent, 'imports', `${names.pascal}Module`, module);
    return;
  }

  const file = path.join(folder, `${names.file}.${kind}.ts`);
  const className = `${names.pascal}${capitalize(kind)}`;

  if (kind === 'module') {
    plan.create(
      file,
      `import { Module } from '@avijs/core';\n\n@Module({})\nexport class ${className} {}\n`,
    );
    await register(
      plan,
      nearestModule(plan, src, path.dirname(folder)),
      'imports',
      className,
      file,
    );
    return;
  }

  if (kind === 'service') {
    plan.create(
      file,
      `import { Injectable } from '@avijs/core';

@Injectable()
export class ${className} {
  findAll(): unknown[] {
    return [];
  }
}
`,
    );
    await register(plan, nearestModule(plan, src, folder), 'providers', className, file);
    return;
  }

  const service = path.join(folder, `${names.file}.service.ts`);
  const serviceClass = `${names.pascal}Service`;
  plan.create(
    file,
    plan.exists(service)
      ? `import { Controller, Get } from '@avijs/core';
import { ${serviceClass} } from './${names.file}.service.js';

@Controller('/${names.file}')
export class ${className} {
  static inject = [${serviceClass}] as const;

  constructor(private readonly ${names.camel}: ${serviceClass}) {}

  @Get()
  findAll() {
    return this.${names.camel}.findAll();
  }
}
`
      : `import { Controller, Get } from '@avijs/core';

@Controller('/${names.file}')
export class ${className} {
  @Get()
  findAll() {
    return [];
  }
}
`,
  );
  await register(plan, nearestModule(plan, src, folder), 'controllers', className, file);
}

async function minimal(
  plan: Plan,
  src: string,
  kind: Kind,
  dirs: readonly string[],
  names: Names,
): Promise<void> {
  if (kind === 'module') {
    throw new GenerateError(
      'This is a minimal project (src/app.ts, no src/app.module.ts), which does not use modules. Generate a controller or service, or see the project structure chapter to move to modules.',
    );
  }
  const app = path.join(src, 'app.ts');
  const service = path.join(src, 'services', ...dirs, `${names.file}.ts`);
  const serviceClass = `${names.pascal}Service`;

  if (kind === 'resource') {
    const routes = path.join(src, 'routes', ...dirs, `${names.file}.ts`);
    plan.create(service, crudService(names, false));
    plan.create(routes, crudRoutes(names, importPath(routes, service)));
    await register(plan, app, 'providers', serviceClass, service);
    await register(plan, app, 'controllers', `${names.camel}Routes`, routes);
    return;
  }

  if (kind === 'service') {
    plan.create(
      service,
      `export class ${serviceClass} {
  findAll(): unknown[] {
    return [];
  }
}
`,
    );
    await register(plan, app, 'providers', serviceClass, service);
    return;
  }

  const file = path.join(src, 'routes', ...dirs, `${names.file}.ts`);
  const exportName = `${names.camel}Routes`;
  const serviceImport = importPath(file, service);
  plan.create(
    file,
    plan.exists(service)
      ? `import { defineController, route } from '@avijs/core';
import { ${serviceClass} } from '${serviceImport}';

export const ${exportName} = defineController({
  prefix: '/${names.file}',
  inject: [${serviceClass}],
  routes: (${names.camel}) => [
    route({ method: 'GET', path: '/', handler: () => ${names.camel}.findAll() }),
  ],
});
`
      : `import { defineController, route } from '@avijs/core';

export const ${exportName} = defineController({
  prefix: '/${names.file}',
  routes: [route({ method: 'GET', path: '/', handler: () => [] })],
});
`,
  );
  await register(plan, app, 'controllers', exportName, file);
}

/** The closest `*.module.ts` from `dir` up to `src/modules`, else `src/app.module.ts`. */
function nearestModule(plan: Plan, src: string, dir: string): string {
  const stop = path.join(src, 'modules');
  for (let current = dir; current.startsWith(stop); current = path.dirname(current)) {
    const own = path.join(current, `${path.basename(current)}.module.ts`);
    if (plan.exists(own)) return own;
    if (existsSync(current)) {
      const other = readdirSync(current)
        .filter((entry) => entry.endsWith('.module.ts'))
        .sort()[0];
      if (other) return path.join(current, other);
    }
    if (current === stop) break;
  }
  return path.join(src, 'app.module.ts');
}

/**
 * Adds `identifier` to the `property` array of the first `@Module({...})`, `defineModule({...})`
 * or `.register({...})` object in `file`, and imports it. Leaves a note when it can't.
 */
async function register(
  plan: Plan,
  file: string,
  property: string,
  identifier: string,
  from: string,
): Promise<void> {
  const where = path.basename(file);
  const manual = `NOTE   Add ${identifier} to ${property} in ${where} yourself (import it from '${importPath(file, from)}').`;
  if (!plan.exists(file)) {
    plan.notes.push(manual);
    return;
  }
  const text = await plan.read(file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const object = findRegistration(source);
  if (!object) {
    plan.notes.push(manual);
    return;
  }

  const edits: { at: number; text: string }[] = [];
  const existing = object.properties.find(
    (prop): prop is ts.PropertyAssignment =>
      ts.isPropertyAssignment(prop) && prop.name.getText(source) === property,
  );
  if (existing) {
    const array = existing.initializer;
    if (!ts.isArrayLiteralExpression(array)) {
      plan.notes.push(manual);
      return;
    }
    if (array.elements.some((element) => element.getText(source) === identifier)) return;
    const last = array.elements.at(-1);
    edits.push(
      last
        ? { at: last.getEnd(), text: `, ${identifier}` }
        : { at: array.getStart(source) + 1, text: identifier },
    );
  } else {
    const last = object.properties.at(-1);
    edits.push(
      last
        ? { at: last.getEnd(), text: `, ${property}: [${identifier}]` }
        : { at: object.getStart(source) + 1, text: ` ${property}: [${identifier}] ` },
    );
  }

  const imported = source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((e) => e.name.text === identifier),
  );
  if (!imported) {
    const line = `import { ${identifier} } from '${importPath(file, from)}';`;
    const lastImport = source.statements.filter(ts.isImportDeclaration).at(-1);
    edits.push(
      lastImport ? { at: lastImport.getEnd(), text: `\n${line}` } : { at: 0, text: `${line}\n` },
    );
  }

  let updated = text;
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    updated = updated.slice(0, edit.at) + edit.text + updated.slice(edit.at);
  }
  plan.update(file, updated);
}

function findRegistration(source: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  let found: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      const [first] = node.arguments;
      if (
        (name === 'Module' || name === 'defineModule' || name === 'register') &&
        first &&
        ts.isObjectLiteralExpression(first)
      ) {
        found = first;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function importPath(from: string, to: string): string {
  const relative = path
    .relative(path.dirname(from), to)
    .replaceAll('\\', '/')
    .replace(/\.ts$/, '.js');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function toNames(file: string): Names {
  const camel = file.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
  return { file, camel, pascal: capitalize(camel) };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** `posts` → `Post`, `categories` → `Category`; names without a plural `s` stay as they are. */
function singular(pascal: string): string {
  if (pascal.endsWith('ies')) return `${pascal.slice(0, -3)}y`;
  if (pascal.endsWith('s') && !pascal.endsWith('ss')) return pascal.slice(0, -1);
  return pascal;
}

function resourceModule(names: Names): string {
  return `import { Module } from '@avijs/core';
import { ${names.pascal}Controller } from './${names.file}.controller.js';
import { ${names.pascal}Service } from './${names.file}.service.js';

@Module({ controllers: [${names.pascal}Controller], providers: [${names.pascal}Service] })
export class ${names.pascal}Module {}
`;
}

function crudService(names: Names, decorated: boolean): string {
  const item = singular(names.pascal);
  const imports = decorated ? 'HttpError, Injectable' : 'HttpError';
  return `import { ${imports} } from '@avijs/core';

export interface ${item} {
  id: number;
  [field: string]: unknown;
}

/** Keeps ${names.file} in memory. Swap the Map for your database; the routes stay the same. */
${decorated ? '@Injectable()\n' : ''}export class ${names.pascal}Service {
  readonly #items = new Map<number, ${item}>();
  #nextId = 1;

  findAll(): ${item}[] {
    return [...this.#items.values()];
  }

  findOne(id: number): ${item} {
    const item = this.#items.get(id);
    if (!item) throw new HttpError(404, \`${item} \${String(id)} not found\`);
    return item;
  }

  create(data: Record<string, unknown>): ${item} {
    const item = { ...data, id: this.#nextId++ };
    this.#items.set(item.id, item);
    return item;
  }

  update(id: number, data: Record<string, unknown>): ${item} {
    const item = { ...this.findOne(id), ...data, id };
    this.#items.set(id, item);
    return item;
  }

  remove(id: number): void {
    this.findOne(id);
    this.#items.delete(id);
  }
}
`;
}

// Shared by the generated controller and routes. Replace them with route schemas
// (see the validation chapter) once the shape of the data is known.
const INPUT_HELPERS = `function idOf(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id)) throw new HttpError(400, 'id must be an integer');
  return id;
}

function bodyOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'Expected a JSON object');
  }
  return value as Record<string, unknown>;
}`;

function crudController(names: Names): string {
  const service = `${names.pascal}Service`;
  const field = names.camel;
  return `import { Controller, Delete, Get, HttpError, Patch, Post, reply, type Context } from '@avijs/core';
import { ${service} } from './${names.file}.service.js';

${INPUT_HELPERS}

@Controller('/${names.file}')
export class ${names.pascal}Controller {
  static inject = [${service}] as const;

  constructor(private readonly ${field}: ${service}) {}

  @Get()
  findAll() {
    return this.${field}.findAll();
  }

  @Get('/:id')
  findOne(ctx: Context) {
    return this.${field}.findOne(idOf(ctx.params['id']));
  }

  @Post()
  async create(ctx: Context) {
    return reply(this.${field}.create(bodyOf(await ctx.json())), { status: 201 });
  }

  @Patch('/:id')
  async update(ctx: Context) {
    return this.${field}.update(idOf(ctx.params['id']), bodyOf(await ctx.json()));
  }

  @Delete('/:id')
  remove(ctx: Context) {
    this.${field}.remove(idOf(ctx.params['id']));
  }
}
`;
}

function crudRoutes(names: Names, serviceImport: string): string {
  const service = `${names.pascal}Service`;
  const field = names.camel;
  return `import { HttpError, defineController, reply, route } from '@avijs/core';
import { ${service} } from '${serviceImport}';

${INPUT_HELPERS}

export const ${field}Routes = defineController({
  prefix: '/${names.file}',
  inject: [${service}],
  routes: (${field}) => [
    route({ method: 'GET', path: '/', handler: () => ${field}.findAll() }),
    route({ method: 'GET', path: '/:id', handler: (ctx) => ${field}.findOne(idOf(ctx.params.id)) }),
    route({
      method: 'POST',
      path: '/',
      handler: async (ctx) => reply(${field}.create(bodyOf(await ctx.json())), { status: 201 }),
    }),
    route({
      method: 'PATCH',
      path: '/:id',
      handler: async (ctx) => ${field}.update(idOf(ctx.params.id), bodyOf(await ctx.json())),
    }),
    route({
      method: 'DELETE',
      path: '/:id',
      handler: (ctx) => {
        ${field}.remove(idOf(ctx.params.id));
      },
    }),
  ],
});
`;
}
