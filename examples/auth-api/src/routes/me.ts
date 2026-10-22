import { defineController, route } from '@avijs/core';
import { CURRENT_USER } from '../auth/current-user.js';
import { AuthGuard } from '../auth/guards.js';

// CURRENT_USER is request-scoped, so this controller is created for each request.
export const meRoutes = defineController({
  prefix: '/me',
  guards: [AuthGuard],
  inject: [CURRENT_USER],
  routes: (user) => [route({ method: 'GET', path: '/', handler: () => user })],
});
