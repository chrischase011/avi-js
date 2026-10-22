import { describe, expect, it } from 'vitest';
import * as di from '@avijs/di';
import * as http from '@avijs/http';
import * as core from '../src/index.js';

describe('@avijs/core', () => {
  it('re-exports the HTTP pieces from @avijs/http', () => {
    expect(core.HTTP_METHODS).toBe(http.HTTP_METHODS);
    expect(core.HttpError).toBe(http.HttpError);
    expect(core.reply).toBe(http.reply);
    expect(core.createToken).toBe(di.createToken);
  });

  it('exposes only the documented runtime exports', () => {
    expect(Object.keys(core).sort()).toEqual([
      'AviFactory',
      'Controller',
      'Delete',
      'Get',
      'HTTP_METHODS',
      'Head',
      'HttpError',
      'Injectable',
      'Module',
      'Options',
      'Patch',
      'Post',
      'Put',
      'REQUEST',
      'UseGuards',
      'UseMiddleware',
      'createAvi',
      'createToken',
      'defineController',
      'defineModule',
      'describeApp',
      'reply',
      'route',
    ]);
  });
});
