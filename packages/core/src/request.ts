import { createToken } from '@avijs/di';
import type { Context } from '@avijs/http';

/** The current request. Inject it into request-scoped providers. */
export const REQUEST = createToken<Context>('REQUEST');

export const REQUEST_TOKENS = [REQUEST];
