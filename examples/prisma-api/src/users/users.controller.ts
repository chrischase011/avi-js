import { Controller, Get, Post, reply, type RouteContext, type RouteSchema } from '@avijs/core';
import * as v from 'valibot';
import { Id } from '../schemas.js';
import { UsersService } from './users.service.js';

const CreateUser = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email()),
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'name is required')),
});

const byId = { params: Id } satisfies RouteSchema;
const create = { body: CreateUser } satisfies RouteSchema;

@Controller('/users')
export class UsersController {
  static inject = [UsersService] as const;

  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Get('/:id', { schema: byId })
  get(ctx: RouteContext<typeof byId>) {
    return this.users.get(ctx.input.params.id);
  }

  @Post('/', { schema: create })
  async create(ctx: RouteContext<typeof create>) {
    return reply(await this.users.create(ctx.input.body), { status: 201 });
  }
}
