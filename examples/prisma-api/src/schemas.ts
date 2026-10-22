import * as v from 'valibot';

/** `:id` path parameters: digits in, a number out. */
export const Id = v.object({
  id: v.pipe(v.string(), v.regex(/^\d+$/, 'id must be a number'), v.transform(Number)),
});
