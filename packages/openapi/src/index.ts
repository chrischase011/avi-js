import type { AviApp, RouteInfo, StandardSchemaV1 } from '@avijs/core';

export type JsonSchema = Record<string, unknown>;

export interface OpenApiOptions {
  info: { title: string; version: string; description?: string };
  servers?: readonly { url: string; description?: string }[];
  /**
   * Converts a route schema to JSON Schema. Without it, schemas that implement Standard JSON
   * Schema (`~standard.jsonSchema`) are converted; other schemas are left undocumented.
   */
  toJsonSchema?: (schema: StandardSchemaV1, io: 'input' | 'output') => JsonSchema | undefined;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: OpenApiOptions['info'];
  servers?: OpenApiOptions['servers'];
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, JsonSchema> };
}

interface Parameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  schema: JsonSchema;
}

interface Operation {
  summary?: string;
  description?: string;
  tags?: readonly string[];
  operationId?: string;
  deprecated?: boolean;
  parameters?: Parameter[];
  requestBody?: { required: true; content: { 'application/json': { schema: JsonSchema } } };
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: JsonSchema }> }
  >;
}

const VALIDATION_ERROR: JsonSchema = {
  type: 'object',
  required: ['statusCode', 'error', 'message'],
  properties: {
    statusCode: { type: 'integer' },
    error: { type: 'string' },
    message: { type: 'string' },
    details: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              in: { enum: ['params', 'query', 'body'] },
              path: { type: 'array', items: { type: ['string', 'number'] } },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

/** Builds an OpenAPI 3.1 document from an initialized app's routes and schemas. */
export function generateOpenApi(app: AviApp, options: OpenApiOptions): OpenApiDocument {
  const convert = (schema: StandardSchemaV1 | undefined, io: 'input' | 'output') =>
    schema ? (options.toJsonSchema ?? standardJsonSchema)(schema, io) : undefined;

  const paths: OpenApiDocument['paths'] = {};
  let usesValidation = false;

  for (const route of [...app.routes()].sort(byPath)) {
    const { path, names } = openApiPath(route.path);
    const operation: Operation = { ...route.openapi, responses: {} };
    const parameters: Parameter[] = [];

    const params = objectProperties(convert(route.schema?.params, 'input'));
    for (const name of names) {
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: params.properties[name === 'wildcard' ? '*' : name] ?? { type: 'string' },
      });
    }

    const query = objectProperties(convert(route.schema?.query, 'input'));
    for (const [name, schema] of Object.entries(query.properties)) {
      parameters.push({ name, in: 'query', required: query.required.includes(name), schema });
    }
    if (parameters.length > 0) operation.parameters = parameters;

    if (route.schema?.body) {
      const body = convert(route.schema.body, 'input') ?? {};
      operation.requestBody = { required: true, content: { 'application/json': { schema: body } } };
    }

    const response = convert(route.schema?.response, 'output');
    operation.responses['200'] = response
      ? { description: 'OK', content: { 'application/json': { schema: response } } }
      : { description: 'OK' };

    if (route.schema?.params || route.schema?.query || route.schema?.body) {
      usesValidation = true;
      operation.responses['400'] = {
        description: 'Validation failed',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } },
        },
      };
    }

    (paths[path] ??= {})[route.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.1.0',
    info: options.info,
    ...(options.servers ? { servers: options.servers } : {}),
    paths,
    components: { schemas: usesValidation ? { ValidationError: VALIDATION_ERROR } : {} },
  };
}

/** `/users/:id/*` → `/users/{id}/{wildcard}`, with the parameter names in order. */
export function openApiPath(path: string): { path: string; names: string[] } {
  const names: string[] = [];
  const converted = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return `{${segment.slice(1)}}`;
      }
      if (segment === '*') {
        names.push('wildcard');
        return '{wildcard}';
      }
      return segment;
    })
    .join('/');
  return { path: converted, names };
}

function standardJsonSchema(
  schema: StandardSchemaV1,
  io: 'input' | 'output',
): JsonSchema | undefined {
  const converter = (
    schema['~standard'] as {
      jsonSchema?: Partial<Record<'input' | 'output', (options: { target: string }) => JsonSchema>>;
    }
  ).jsonSchema?.[io];
  return typeof converter === 'function' ? converter({ target: 'draft-2020-12' }) : undefined;
}

function objectProperties(schema: JsonSchema | undefined): {
  properties: Record<string, JsonSchema>;
  required: string[];
} {
  const properties = (schema?.['properties'] ?? {}) as Record<string, JsonSchema>;
  const required = Array.isArray(schema?.['required']) ? (schema['required'] as string[]) : [];
  return { properties, required };
}

function byPath(a: RouteInfo, b: RouteInfo): number {
  return a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path);
}
