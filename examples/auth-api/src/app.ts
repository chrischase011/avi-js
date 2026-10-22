import { createAvi } from '@avijs/core';
import { cors, securityHeaders } from '@avijs/security';
import { randomBytes } from 'node:crypto';
import { currentUserProvider } from './auth/current-user.js';
import { AUTH_SECRET, TokenService } from './auth/tokens.js';
import { UsersService } from './auth/users.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';

export interface AppOptions {
  /** Signs tokens. Without one, a random secret is used and tokens die with the process. */
  secret?: string | undefined;
  /** The browser app allowed to call this API. */
  origin?: string | undefined;
}

export function createApp({ secret, origin = 'http://localhost:5173' }: AppOptions = {}) {
  return createAvi({
    onRequest: [securityHeaders(), cors({ origin, credentials: true })],
  }).register({
    providers: [
      { provide: AUTH_SECRET, useValue: secret ?? randomBytes(32).toString('hex') },
      TokenService,
      UsersService,
      currentUserProvider,
    ],
    controllers: [authRoutes, meRoutes, adminRoutes],
  });
}
