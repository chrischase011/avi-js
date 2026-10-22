import { Controller, Get, Post, reply, type Context, type InputOf } from '@avijs/core';
import * as v from 'valibot';
import { Id } from '../schemas.js';
import { UsersService } from './users.service.js';

const CreateUser = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email()),
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'name is required')),
});

@Controller('/users')
export class UsersController {
  static inject = [UsersService] as const;

  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Get('/:id', { schema: { params: Id } })
  get(ctx: Context<InputOf<{ params: typeof Id }>>) {
    return this.users.get(ctx.input.params.id);
  }

  @Post('/', { schema: { body: CreateUser } })
  async create(ctx: Context<InputOf<{ body: typeof CreateUser }>>) {
    return reply(await this.users.create(ctx.input.body), { status: 201 });
  }
}
