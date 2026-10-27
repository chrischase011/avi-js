import type { Reply } from '@avijs/http';
import type { InferInput, InferOutput, PathParams, StandardSchemaV1 } from '@avijs/validation';
import type { ControllerDefinition } from './controller.js';

// Types `avi client` uses to describe each route to a typed client. Type-only.

type Fn = (...args: never[]) => unknown;
// A route without a schema.
interface NoSchema {
  readonly params?: never;
}
type Dropped = undefined | symbol | bigint | Fn;

type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];
type JsonKeys<T> = {
  [K in keyof T]-?: K extends symbol ? never : [T[K]] extends [Dropped] ? never : K;
}[keyof T];

type JsonObject<T> = {
  [K in Exclude<JsonKeys<T>, OptionalKeys<T>>]: Jsonify<T[K]>;
} & {
  [K in Extract<JsonKeys<T>, OptionalKeys<T>>]?: Jsonify<Exclude<T[K], undefined>>;
} extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

/** The type of `JSON.parse(JSON.stringify(value))` for a value of type `T`. */
export type Jsonify<T> = unknown extends T
  ? T
  : T extends string | number | boolean | null
    ? T
    : T extends Dropped
      ? never
      : T extends { toJSON(): infer J }
        ? Jsonify<J>
        : T extends readonly unknown[]
          ? {
              -readonly [K in keyof T]:
                Jsonify<T[K]> | (Extract<T[K], Dropped> extends never ? never : null);
            }
          : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
            ? Record<string, never>
            : JsonObject<T>;

/**
 * A Node.js stream, by shape: importing `node:stream` here would turn every response type into
 * `any` in a frontend compiled without Node types.
 */
interface NodeStream {
  readonly readable: boolean;
  pipe(destination: never, options?: never): unknown;
}

/** What the client receives for a handler result `R`. */
export type ResponseBody<R> = unknown extends R
  ? unknown
  : // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- handlers that return nothing
    [R] extends [undefined | void]
    ? undefined
    : R extends Reply<infer B>
      ? ResponseBody<B>
      : R extends Uint8Array | ReadableStream | NodeStream
        ? Response
        : R extends Response
          ? unknown
          : Jsonify<R>;

type Input<S, K extends string> =
  S extends Partial<Record<K, infer X>>
    ? X extends StandardSchemaV1
      ? InferInput<X>
      : undefined
    : undefined;

/** The endpoint for full path `P`, route schema `S` and handler result `R`. */
export interface Endpoint<P extends string, S, R> {
  readonly params: Input<S, 'params'> extends undefined ? PathParams<P> : Input<S, 'params'>;
  readonly query: Input<S, 'query'>;
  readonly body: Input<S, 'body'>;
  readonly response: S extends { readonly response?: infer X }
    ? X extends StandardSchemaV1
      ? Jsonify<InferOutput<X>>
      : ResponseBody<Awaited<R>>
    : ResponseBody<Awaited<R>>;
}

type SchemaOf<C> = C extends { readonly '~schema'?: infer S }
  ? unknown extends S
    ? NoSchema
    : S
  : NoSchema;

/** The endpoint of a `@Get`/`@Post`/... method `H` at full path `P`. */
export type MethodEndpoint<P extends string, H> = H extends (...args: infer A) => infer R
  ? Endpoint<P, A extends readonly [infer C, ...unknown[]] ? SchemaOf<C> : NoSchema, R>
  : never;

type RouteAt<C, I extends number> =
  C extends ControllerDefinition<infer Routes> ? Routes[I] : never;

/** The endpoint of route number `I` in a `defineController` controller `C`, at full path `P`. */
export type RouteEndpoint<P extends string, C, I extends number> =
  RouteAt<C, I> extends infer X
    ? X extends { readonly '~types'?: { readonly schema: infer S; readonly result: infer R } }
      ? unknown extends R
        ? PlainEndpoint<P, X>
        : Endpoint<P, S, R>
      : PlainEndpoint<P, X>
    : never;

type PlainEndpoint<P extends string, X> = X extends {
  readonly handler: (...args: never[]) => infer R;
}
  ? Endpoint<P, X extends { readonly schema?: infer S } ? S : NoSchema, R>
  : never;
