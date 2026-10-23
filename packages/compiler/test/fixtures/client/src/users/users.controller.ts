import { Controller, Get, Post, reply, type Context, type RouteContext } from '@avijs/core';
import * as v from 'valibot';

const PREFIX = '/users';
const create = { body: v.object({ name: v.string() }) } as const;
const list = { query: v.object({ page: v.optional(v.string()) }) } as const;

@Controller(PREFIX)
export class UsersController {
  @Get('', { schema: list })
  findAll(ctx: RouteContext<typeof list>) {
    return [{ id: 1, name: 'Shiela', page: ctx.input.query.page }];
  }

  @Get('/:id')
  findOne(ctx: Context) {
    return { id: Number(ctx.params['id']), joined: new Date() };
  }

  @Post('/', { schema: create })
  create(ctx: RouteContext<typeof create>) {
    return reply({ id: 2, name: ctx.input.body.name }, { status: 201 });
  }

  // The schema is there, but ctx does not say so: AVI105.
  @Post('/import', { schema: create })
  importMany(ctx: Context) {
    return { ok: ctx.method };
  }
}
