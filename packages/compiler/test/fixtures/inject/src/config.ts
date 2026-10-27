import { defineConfig, type TokenType } from '@avijs/core';
import * as v from 'valibot';

export const Config = defineConfig(v.object({ NAME: v.optional(v.string(), 'avi') }));
export type Config = TokenType<typeof Config>;
