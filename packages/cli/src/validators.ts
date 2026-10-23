/** Validation libraries generated code can use. `none` keeps handwritten checks. */
export type Validator = 'valibot' | 'zod' | 'none';

export const VALIDATORS: readonly Validator[] = ['valibot', 'zod', 'none'];

/** Version ranges added to a new project's dependencies. */
export const VALIDATOR_VERSIONS: Record<Exclude<Validator, 'none'>, string> = {
  valibot: '^1.5.0',
  zod: '^4.6.0',
};

/** How each library spells the few schemas the templates and generators need. */
export interface SchemaSyntax {
  readonly import: string;
  /** Params `{ id }`: digits in, a number out. */
  readonly id: string;
  readonly number: string;
  readonly string: string;
  /** An optional `PORT` variable: digits, as a number, default 3000. */
  readonly port: string;
  /** A trimmed, required string of at most `max` characters. */
  text(max: number, required: string): string;
  object(fields: readonly (readonly [string, string])[]): string;
  array(item: string): string;
  /** Every field of `schema` optional, but at least one present. */
  partialNonEmpty(schema: string): string;
  /** The output type of `schema`. */
  infer(schema: string): string;
}

const fields = (entries: readonly (readonly [string, string])[]) =>
  entries.map(([key, value]) => `  ${key}: ${value},\n`).join('');

export const SYNTAX: Record<Exclude<Validator, 'none'>, SchemaSyntax> = {
  valibot: {
    import: "import * as v from 'valibot';",
    id: `v.object({
  id: v.pipe(v.string(), v.regex(/^\\d+$/, 'id must be a number'), v.transform(Number)),
})`,
    number: 'v.number()',
    string: 'v.string()',
    port: `v.optional(
    v.pipe(v.string(), v.regex(/^\\d+$/, 'PORT must be a number'), v.transform(Number)),
    '3000',
  )`,
    text: (max, required) =>
      `v.pipe(v.string(), v.trim(), v.minLength(1, '${required}'), v.maxLength(${String(max)}))`,
    object: (entries) => `v.object({\n${fields(entries)}})`,
    array: (item) => `v.array(${item})`,
    partialNonEmpty: (schema) => `v.pipe(
  v.partial(${schema}),
  v.check((input) => Object.keys(input).length > 0, 'nothing to update'),
)`,
    infer: (schema) => `v.InferOutput<typeof ${schema}>`,
  },
  zod: {
    import: "import { z } from 'zod';",
    id: `z.object({
  id: z.string().regex(/^\\d+$/, 'id must be a number').transform(Number),
})`,
    number: 'z.number()',
    string: 'z.string()',
    port: "z.string().regex(/^\\d+$/, 'PORT must be a number').default('3000').transform(Number)",
    text: (max, required) => `z.string().trim().min(1, '${required}').max(${String(max)})`,
    object: (entries) => `z.object({\n${fields(entries)}})`,
    array: (item) => `z.array(${item})`,
    partialNonEmpty: (schema) => `${schema}
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'nothing to update')`,
    infer: (schema) => `z.infer<typeof ${schema}>`,
  },
};

/** The validator a project already uses, from its package.json; Valibot wins over Zod. */
export function detectValidator(packageJson: unknown): Validator {
  const pkg = packageJson as {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  } | null;
  const has = (name: string) =>
    pkg?.dependencies?.[name] !== undefined || pkg?.devDependencies?.[name] !== undefined;
  if (has('valibot')) return 'valibot';
  if (has('zod')) return 'zod';
  return 'none';
}
