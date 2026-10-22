import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/index.js';

describe('HttpError', () => {
  it('defaults the message to the status text', () => {
    const error = new HttpError(404);
    expect(error.status).toBe(404);
    expect(error.message).toBe('Not Found');
    expect(error.name).toBe('HttpError');
    expect(error).toBeInstanceOf(Error);
  });

  it('keeps a custom message and cause', () => {
    const cause = new Error('root');
    const error = new HttpError(409, 'Email taken', { cause });
    expect(error.message).toBe('Email taken');
    expect(error.cause).toBe(cause);
  });

  it.each([200, 399, 600, 404.5, Number.NaN])('rejects status %s', (status) => {
    expect(() => new HttpError(status)).toThrow(RangeError);
  });
});
