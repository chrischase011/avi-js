import { describe, expect, it } from 'vitest';
import { reply } from '../src/index.js';

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
