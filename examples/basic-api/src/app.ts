import { createAvi, defineController, HttpError, reply } from '@avi/core';

interface User {
  id: number;
  name: string;
}

const users: User[] = [{ id: 1, name: 'Ada' }];

const hello = defineController({
  routes: [
    { method: 'GET', path: '/', handler: () => ({ message: 'Hello, Avi' }) },
    { method: 'GET', path: '/health', handler: () => 'ok' },
  ],
});

const usersController = defineController({
  prefix: '/users',
  routes: [
    { method: 'GET', path: '/', handler: () => users },
    {
      method: 'GET',
      path: '/:id',
      handler: (ctx) => {
        const user = users.find((u) => String(u.id) === ctx.params['id']);
        if (!user) throw new HttpError(404, 'User not found');
        return user;
      },
    },
    {
      method: 'POST',
      path: '/',
      handler: async (ctx) => {
        const input = await ctx.json();
        if (typeof input !== 'object' || input === null || !('name' in input)) {
          throw new HttpError(400, 'Body must be an object with a name');
        }
        const user = { id: users.length + 1, name: String(input.name) };
        users.push(user);
        return reply(user, { status: 201, headers: { location: `/users/${String(user.id)}` } });
      },
    },
  ],
});

export function createApp() {
  return createAvi().register({ controllers: [hello, usersController] });
}
