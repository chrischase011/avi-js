import {
  Controller,
  Get,
  createAvi,
  defineController,
  route,
  type AviApp,
  type StandardSchemaV1,
} from '@avi/core';
import * as v from 'valibot';
import { afterEach, describe, expect, it } from 'vitest';
import { generateOpenApi, openApiPath, type JsonSchema } from '../src/index.js';

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
