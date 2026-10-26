import { defineConfig, type TokenType } from '@avijs/core';
import * as v from 'valibot';

// Environment variables, checked when the app starts. A .env file is read too, if present.
const env = v.object({
  PORT: v.optional(v.pipe(v.string(), v.regex(/^\d+$/), v.transform(Number)), '3000'),
  DATABASE_URL: v.optional(v.string(), 'file:./dev.db'),
});

export const Config = defineConfig(env, { envFile: '.env' });
export type Config = TokenType<typeof Config>;
