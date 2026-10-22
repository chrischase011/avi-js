import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';
import * as http from '@avi/http';

describe('@avi/core', () => {
  it('re-exports the HTTP method list from @avi/http', () => {
    expect(core.HTTP_METHODS).toBe(http.HTTP_METHODS);
  });

  it('exposes only the documented runtime exports', () => {
    expect(Object.keys(core).sort()).toEqual(['HTTP_METHODS']);
  });
});
