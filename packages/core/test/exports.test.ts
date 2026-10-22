import { describe, expect, it } from 'vitest';
import * as di from '@avi/di';
import * as http from '@avi/http';
import * as core from '../src/index.js';

describe('@avi/core', () => {
  it('re-exports the HTTP pieces from @avi/http', () => {
    expect(core.HTTP_METHODS).toBe(http.HTTP_METHODS);
    expect(core.HttpError).toBe(http.HttpError);
    expect(core.reply).toBe(http.reply);
    expect(core.createToken).toBe(di.createToken);
  });

  it('exposes only the documented runtime exports', () => {
    expect(Object.keys(core).sort()).toEqual([
      'HTTP_METHODS',
      'HttpError',
      'createAvi',
      'createToken',
      'defineController',
      'defineModule',
      'reply',
    ]);
  });
});
