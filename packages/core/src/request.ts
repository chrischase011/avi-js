import { createToken } from '@avijs/di';
import type { Context } from '@avijs/http';
import type { RouteInfo } from './app.js';

/** The current request. Inject it into request-scoped providers. */
export const REQUEST = createToken<Context>('REQUEST');

export const REQUEST_TOKENS = [REQUEST];

/** What `APP` gives a provider: a read-only view of the app. */
export interface AppInfo {
  /** The registered routes, once the app is initialized. */
  routes(): readonly RouteInfo[];
}

/** A read-only view of the app, for providers that read its routes, such as an OpenAPI document. */
export const APP = createToken<AppInfo>('APP');
