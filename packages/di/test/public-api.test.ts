// Changing this list changes the public API: review it, then update CHANGELOG.md.
import { expect, it } from 'vitest';
import * as api from '../src/index.js';

it('exposes only the reviewed runtime exports', () => {
  expect(Object.keys(api).sort()).toEqual([
    'Container',
    'createToken',
    'defineFactory',
    'registerInjects',
  ]);
});
