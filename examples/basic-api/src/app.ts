import { createAvi, defineController, HttpError, reply, type Middleware } from '@avijs/core';

interface User {
  id: number;
  name: string;
}

const users: User[] = [{ id: 1, name: 'Shiela' }];

export const hello = defineController({
  routes: [
    { method: 'GET', path: '/', handler: () => ({ message: 'Hello, Avi' }) },
    { method: 'GET', path: '/health', handler: () => 'ok' },
  ],
});

export const usersController = defineController({
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

let nextRequest = 0;

const requestId: Middleware = (ctx, next) => {
  ctx.setHeader('x-request-id', String(++nextRequest));
  return next();
};

export function createApp() {
  return createAvi({ middleware: [requestId] }).register({ controllers: [hello, usersController] });
}
