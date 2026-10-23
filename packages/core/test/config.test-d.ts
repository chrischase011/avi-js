import * as v from 'valibot';
import { expectTypeOf, it } from 'vitest';
import { defineConfig, type TokenType } from '../src/index.js';

it('infers the config type from the schema output', () => {
  const Config = defineConfig(
    v.object({
      PORT: v.optional(v.pipe(v.string(), v.transform(Number)), '3000'),
      DEBUG: v.optional(v.picklist(['on', 'off'])),
    }),
  );
  interface Expected {
    PORT: number;
    DEBUG?: 'on' | 'off' | undefined;
  }
  expectTypeOf<TokenType<typeof Config>>().toEqualTypeOf<Expected>();
  expectTypeOf(() => Config.load()).returns.resolves.toEqualTypeOf<Expected>();
});
