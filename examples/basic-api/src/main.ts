// Phase 0 smoke check: resolves @avi/core from its built output like a real consumer.
// This becomes a working HTTP API in Phase 1.
import assert from 'node:assert/strict';
import { HTTP_METHODS, type HttpMethod } from '@avi/core';

const get: HttpMethod = 'GET';
assert.ok(HTTP_METHODS.includes(get));

console.log(`@avi/core loaded: ${HTTP_METHODS.join(', ')}`);
