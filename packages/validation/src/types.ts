import type { Reply } from '@avijs/http';
import type { InferInput, InferOutput, StandardSchemaV1 } from './standard-schema.js';

export interface RouteSchema {
  readonly params?: StandardSchemaV1;
  readonly query?: StandardSchemaV1;
  readonly body?: StandardSchemaV1;
  /** Validates what the handler returns; the schema's output is sent instead. */
  readonly response?: StandardSchemaV1;
}

type InputKey = 'params' | 'query' | 'body';

/** The type of `ctx.input` for a route schema. */
export type InputOf<S extends RouteSchema> = {
  readonly [
    K in keyof S & InputKey as S[K] extends StandardSchemaV1 ? K : never
  ]: S[K] extends StandardSchemaV1 ? InferOutput<S[K]> : never;
};

/** What a handler may return for a route schema. */
export type ResultOf<S extends RouteSchema> = S['response'] extends StandardSchemaV1
  ? InferInput<S['response']> | Reply | Promise<InferInput<S['response']> | Reply>
  : unknown;

type Segments<P extends string> = P extends `${infer Head}/${infer Rest}`
  ? Head | Segments<Rest>
  : P;

type ParamName<S> = S extends `:${infer Name}` ? Name : S extends '*' ? '*' : never;

/** Path parameters of a route pattern: `'/users/:id/*'` → `{ id: string; '*': string }`. */
export type PathParams<P extends string> = string extends P
  ? Readonly<Record<string, string>>
  : Readonly<Record<ParamName<Segments<P>>, string>>;
