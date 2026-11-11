import { Controller, Get, HttpError, Post, reply, type Context } from '@avijs/core';
import { parseCreateUser } from './users.schemas.js';
import { UsersService } from './users.service.js';

@Controller('/users')
export class UsersController {
  static inject = [UsersService] as const;

  constructor(private readonly users: UsersService) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get('/:id')
  findOne(ctx: Context) {
    const user = this.users.findOne(Number(ctx.params['id']));
    if (!user) throw new HttpError(404, 'User not found');
    return user;
  }

  @Post()
  async create(ctx: Context) {
    const input = parseCreateUser(await ctx.json());
    if (!input) throw new HttpError(400, 'Body must be an object with a name');
    const user = this.users.create(input);
    return reply(user, { status: 201, headers: { location: `/users/${String(user.id)}` } });
  }
}
