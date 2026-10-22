import { defineController, route } from '@avijs/core';
import { AuthGuard, requireRole } from '../auth/guards.js';
import { UsersService } from '../auth/users.js';

export const adminRoutes = defineController({
  prefix: '/admin',
  guards: [AuthGuard, requireRole('admin')],
  inject: [UsersService],
  routes: (users) => [
    route({ method: 'GET', path: '/stats', handler: () => ({ users: users.count() }) }),
  ],
});
