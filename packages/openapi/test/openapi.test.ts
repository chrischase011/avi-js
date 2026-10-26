import {
  Controller,
  Get,
  createAvi,
  defineController,
  defineModule,
  route,
  type AviApp,
  type StandardSchemaV1,
} from '@avijs/core';
import { toJsonSchema as valibotToJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenApiModule, generateOpenApi, openApiPath, type JsonSchema } from '../src/index.js';

/** A schema that validates nothing but carries Standard JSON Schema converters. */
function documented(json: JsonSchema): StandardSchemaV1 {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => ({ value }),
      jsonSchema: { input: () => json, output: () => json },
    } as StandardSchemaV1['~standard'],
  };
}

const UserParams = documented({
  type: 'object',
  properties: { id: { type: 'string', pattern: '^\\d+$' } },
  required: ['id'],
});
const Paging = documented({
  type: 'object',
  properties: { page: { type: 'string' }, size: { type: 'string' } },
  required: ['page'],
});
const CreateUser = documented({
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
});
const PublicUser = documented({ type: 'object', properties: { id: { type: 'number' } } });

const running: AviApp[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()));
});

async function initialized(app: AviApp): Promise<AviApp> {
  running.push(app);
  await app.init();
  return app;
}

describe('generateOpenApi', () => {
  it('documents paths, parameters, bodies and responses', async () => {
    const users = defineController({
      name: 'Users',
      prefix: '/users',
      routes: [
        route({
          method: 'GET',
          path: '/',
          schema: { query: Paging },
          openapi: { summary: 'List users', tags: ['users'] },
          handler: () => [],
        }),
        route({
          method: 'GET',
          path: '/:id',
          schema: { params: UserParams, response: PublicUser },
          openapi: { operationId: 'getUser' },
          handler: () => ({ id: 1 }),
        }),
        route({ method: 'POST', path: '/', schema: { body: CreateUser }, handler: () => 'ok' }),
      ],
    });
    const app = await initialized(createAvi().register({ controllers: [users] }));
    const doc = generateOpenApi(app, { info: { title: 'Greeter', version: '1.0.0' } });

    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(['/users', '/users/{id}']);
    expect(doc.paths['/users']?.['get']).toEqual({
      summary: 'List users',
      tags: ['users'],
      parameters: [
        { name: 'page', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'size', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'OK' },
        '400': {
          description: 'Validation failed',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } },
          },
        },
      },
    });
    expect(doc.paths['/users/{id}']?.['get']).toMatchObject({
      operationId: 'getUser',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d+$' } },
      ],
      responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
    });
    expect(doc.paths['/users']?.['post']?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
      },
    });
    expect(doc.components.schemas['ValidationError']).toBeDefined();
  });

  it('includes decorated routes, runtime routes and their docs', async () => {
    @Controller('/health')
    class Health {
      @Get('/', { openapi: { summary: 'Liveness probe', deprecated: false } })
      check() {
        return 'ok';
      }
    }
    const late = defineController({
      inject: [],
      routes: () => [{ method: 'GET', path: '/late', handler: () => 'late' }],
    });
    const app = await initialized(createAvi().register({ controllers: [Health, late] }));
    const doc = generateOpenApi(app, { info: { title: 'T', version: '1' } });
    expect(doc.paths['/health']?.['get']).toEqual({
      summary: 'Liveness probe',
      deprecated: false,
      responses: { '200': { description: 'OK' } },
    });
    expect(doc.paths['/late']).toBeDefined();
    expect(doc.components.schemas).toEqual({});
  });

  it('uses a converter for schemas without built-in JSON Schema', async () => {
    const Body = v.object({ title: v.string() });
    const app = await initialized(
      createAvi().register({
        controllers: [
          defineController({
            routes: [
              route({ method: 'POST', path: '/notes', schema: { body: Body }, handler: () => 1 }),
            ],
          }),
        ],
      }),
    );

    const without = generateOpenApi(app, { info: { title: 'T', version: '1' } });
    expect(
      without.paths['/notes']?.['post']?.requestBody?.content['application/json'].schema,
    ).toEqual({});

    const withConverter = generateOpenApi(app, {
      info: { title: 'T', version: '1' },
      toJsonSchema: (schema, io) => (schema === Body ? { type: 'object', 'x-io': io } : undefined),
    });
    expect(
      withConverter.paths['/notes']?.['post']?.requestBody?.content['application/json'].schema,
    ).toEqual({
      type: 'object',
      'x-io': 'input',
    });
  });

  it('requires an initialized app', () => {
    expect(() => generateOpenApi(createAvi(), { info: { title: 'T', version: '1' } })).toThrow(
      'before app.routes()',
    );
  });
});

describe('openApiPath', () => {
  it.each([
    ['/users', '/users', []],
    ['/users/:id/posts/:postId', '/users/{id}/posts/{postId}', ['id', 'postId']],
    ['/files/*', '/files/{wildcard}', ['wildcard']],
  ])('converts %s', (input, path, names) => {
    expect(openApiPath(input)).toEqual({ path, names });
  });
});

// The schemas generated projects use, through the real libraries.
describe('generateOpenApi with schema libraries', () => {
  async function document(
    schema: { params: StandardSchemaV1; body: StandardSchemaV1; response: StandardSchemaV1 },
    toJsonSchema?: Parameters<typeof generateOpenApi>[1]['toJsonSchema'],
  ) {
    const users = defineController({
      prefix: '/users',
      routes: [
        route({ method: 'POST', path: '/:id', schema, handler: () => ({ id: 1, name: 'a' }) }),
      ],
    });
    const app = await initialized(createAvi().register({ controllers: [users] }));
    const doc = generateOpenApi(app, {
      info: { title: 'T', version: '1' },
      ...(toJsonSchema ? { toJsonSchema } : {}),
    });
    return doc.paths['/users/{id}']?.['post'];
  }

  const expected = {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 1 } },
            required: ['name'],
          },
        },
      },
    },
    responses: {
      '200': {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { id: { type: 'number' }, name: { type: 'string' } },
            },
          },
        },
      },
    },
  };

  it('reads Zod 4 schemas without a converter', async () => {
    const operation = await document({
      params: z.object({ id: z.string() }),
      body: z.object({ name: z.string().min(1) }),
      response: z.object({ id: z.number(), name: z.string() }),
    });
    expect(operation).toMatchObject(expected);
  });

  it('names the route and part when a converter fails', async () => {
    const schemas = {
      params: v.object({ id: v.pipe(v.string(), v.transform(Number)) }),
      body: v.object({ name: v.string() }),
      response: v.object({ id: v.number(), name: v.string() }),
    };
    await expect(
      document(schemas, (schema) => valibotToJsonSchema(schema as never) as JsonSchema),
    ).rejects.toThrow(
      'Cannot convert the params schema of POST /users/:id to JSON Schema: The "transform" action cannot be converted to JSON Schema.',
    );
    const lenient = await document(schemas, (schema) =>
      valibotToJsonSchema(schema as never, { errorMode: 'ignore' }),
    );
    expect(lenient?.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  it('reads Valibot schemas through @valibot/to-json-schema', async () => {
    const schemas = {
      params: v.object({ id: v.string() }),
      body: v.object({ name: v.pipe(v.string(), v.minLength(1)) }),
      response: v.object({ id: v.number(), name: v.string() }),
    };
    expect(await document(schemas)).toMatchObject({
      requestBody: { content: { 'application/json': { schema: {} } } },
    });
    const operation = await document(
      schemas,
      // As chapter 11 shows it: Valibot's own JsonSchema type fits without a cast.
      (schema) => valibotToJsonSchema(schema as never, { errorMode: 'ignore' }),
    );
    expect(operation).toMatchObject(expected);
  });
});

describe('OpenApiModule', () => {
  const users = defineController({
    prefix: '/users',
    routes: [
      route({ method: 'GET', path: '/:id', schema: { params: UserParams }, handler: () => 1 }),
    ],
  });
  const info = { title: 'Users', version: '1.0.0' };

  async function serve(app: AviApp): Promise<string> {
    running.push(app);
    const { port } = await app.listen(0, '127.0.0.1');
    return `http://127.0.0.1:${String(port)}`;
  }

  it('serves the document of the running app, without its own route', async () => {
    const docs = OpenApiModule.forRoot({ info });
    const base = await serve(
      createAvi({ startupSummary: false }).register({ imports: [docs], controllers: [users] }),
    );
    const document = (await (await fetch(`${base}/openapi.json`)).json()) as {
      info: unknown;
      paths: Record<string, unknown>;
    };
    expect(document.info).toEqual(info);
    expect(Object.keys(document.paths)).toEqual(['/users/{id}']);
    expect(await (await fetch(`${base}/openapi.json`)).json()).toEqual(document);
  });

  it('serves at a custom path and documents prefixed modules', async () => {
    const api = defineModule({ prefix: '/api', controllers: [users] });
    const docs = OpenApiModule.forRoot({ info, path: '/docs.json' });
    const base = await serve(
      createAvi({ startupSummary: false }).register({ imports: [api, docs] }),
    );
    const document = (await (await fetch(`${base}/docs.json`)).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(document.paths)).toEqual(['/api/users/{id}']);
  });

  it('builds one document per app when two apps share the module', async () => {
    const docs = OpenApiModule.forRoot({ info });
    const withUsers = await serve(
      createAvi({ startupSummary: false }).register({ imports: [docs], controllers: [users] }),
    );
    const empty = await serve(createAvi({ startupSummary: false }).register({ imports: [docs] }));
    const paths = async (base: string) =>
      Object.keys(
        ((await (await fetch(`${base}/openapi.json`)).json()) as { paths: object }).paths,
      );
    expect(await paths(withUsers)).toEqual(['/users/{id}']);
    expect(await paths(empty)).toEqual([]);
  });
});
