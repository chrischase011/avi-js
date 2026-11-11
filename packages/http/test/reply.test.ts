import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { reply } from '../src/index.js';
import { discardValue } from '../src/respond.js';

describe('reply', () => {
  it('stores body, status and headers', () => {
    const result = reply({ id: 1 }, { status: 201, headers: { location: '/users/1' } });
    expect(result).toMatchObject({
      body: { id: 1 },
      status: 201,
      headers: { location: '/users/1' },
    });
  });

  it('leaves the status unset by default', () => {
    expect(reply('ok').status).toBeUndefined();
  });

  it.each([100, 199, 600, 201.5])('rejects status %s', (status) => {
    expect(() => reply('x', { status })).toThrow(RangeError);
  });
});

describe('discardValue', () => {
  it('destroys a Readable, also inside a reply', () => {
    const plain = Readable.from(['a']);
    const wrapped = Readable.from(['b']);
    discardValue(plain);
    discardValue(reply(wrapped));
    expect(plain.destroyed).toBe(true);
    expect(wrapped.destroyed).toBe(true);
  });

  it("cancels a ReadableStream and a Response's body", async () => {
    const cancelled: string[] = [];
    const stream = (name: string) =>
      new ReadableStream({
        cancel: () => {
          cancelled.push(name);
        },
      });
    discardValue(stream('stream'));
    discardValue(new Response(stream('response')));
    discardValue(reply(stream('reply')));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cancelled.sort()).toEqual(['reply', 'response', 'stream']);
  });

  it('ignores values without a body to release', () => {
    expect(() => {
      discardValue({ id: 1 });
      discardValue(undefined);
      discardValue(new Response(null));
    }).not.toThrow();
  });
});
