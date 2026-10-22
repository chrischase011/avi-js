// The Standard Schema v1 interface (https://standardschema.dev, MIT). Libraries such as Zod,
// Valibot and ArkType implement it, so Avi.js needs no adapters or runtime dependency.

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaProps<Input, Output>;
}

export interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (
    value: unknown,
  ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  readonly types?: { readonly input: Input; readonly output: Output } | undefined;
}

export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] };

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

export type InferInput<S extends StandardSchemaV1> = NonNullable<S['~standard']['types']>['input'];

export type InferOutput<S extends StandardSchemaV1> = NonNullable<
  S['~standard']['types']
>['output'];
