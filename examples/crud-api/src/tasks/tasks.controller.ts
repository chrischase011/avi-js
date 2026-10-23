import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  reply,
  type RouteContext,
  type RouteSchema,
} from '@avijs/core';
import { CreateTask, ListQuery, TaskId, UpdateTask } from './task.schema.js';
import { TasksService } from './tasks.service.js';

// Each route's schema is declared once: the decorator validates with it, RouteContext types it.
const list = { query: ListQuery } satisfies RouteSchema;
const byId = { params: TaskId } satisfies RouteSchema;
const create = { body: CreateTask } satisfies RouteSchema;
const update = { params: TaskId, body: UpdateTask } satisfies RouteSchema;

@Controller('/tasks')
export class TasksController {
  static inject = [TasksService] as const;

  constructor(private readonly tasks: TasksService) {}

  @Get('/', { schema: list })
  list(ctx: RouteContext<typeof list>) {
    return this.tasks.list(ctx.input.query);
  }

  @Get('/:id', { schema: byId })
  get(ctx: RouteContext<typeof byId>) {
    return this.tasks.get(ctx.input.params.id);
  }

  @Post('/', { schema: create })
  create(ctx: RouteContext<typeof create>) {
    const task = this.tasks.create(ctx.input.body);
    return reply(task, { status: 201, headers: { location: `/tasks/${String(task.id)}` } });
  }

  @Patch('/:id', { schema: update })
  update(ctx: RouteContext<typeof update>) {
    return this.tasks.update(ctx.input.params.id, ctx.input.body);
  }

  @Delete('/:id', { schema: byId })
  remove(ctx: RouteContext<typeof byId>) {
    this.tasks.remove(ctx.input.params.id);
  }
}
