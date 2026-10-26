import { createToken } from '@avijs/di';
import type { Context } from '@avijs/http';
import type { AviApp } from './app.js';

/** The current request. Inject it into request-scoped providers. */
export const REQUEST = createToken<Context>('REQUEST');

export const REQUEST_TOKENS = [REQUEST];

/** The app itself, for providers that read its routes, such as an OpenAPI document. */
export const APP = createToken<AviApp>('APP');
