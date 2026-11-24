import type { Context, Upgrade } from '@avijs/core';
import * as v from 'valibot';
import { expectTypeOf, test } from 'vitest';
import type { WebSocket } from 'ws';
import { websocket, type WebSocketMessage } from '../src/index.js';

declare const ctx: Context;

test('messages are strings or bytes without a schema', () => {
  const result = websocket(ctx, async (socket) => {
    for await (const message of socket) expectTypeOf(message).toEqualTypeOf<WebSocketMessage>();
    expectTypeOf(socket.raw).toEqualTypeOf<WebSocket>();
  });
  expectTypeOf(result).toEqualTypeOf<Upgrade>();
});

test('a message schema types what iterating gives', () => {
  websocket(
    ctx,
    async (socket) => {
      for await (const message of socket) {
        expectTypeOf(message).toEqualTypeOf<{ text: string; count: number }>();
      }
    },
    { message: v.object({ text: v.string(), count: v.pipe(v.string(), v.transform(Number)) }) },
  );
});

test('options are checked', () => {
  // @ts-expect-error origins is a list, '*' or a function
  websocket(ctx, () => undefined, { origins: 'https://a.example' });
  // @ts-expect-error unknown option
  websocket(ctx, () => undefined, { maxMessages: 1 });
});
