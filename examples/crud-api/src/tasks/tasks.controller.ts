import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  reply,
  type Context,
  type InputOf,
} from '@avijs/core';
import { CreateTask, ListQuery, TaskId, UpdateTask } from './task.schema.js';
import { TasksService } from './tasks.service.js';

@Controller('/tasks')
export class TasksController {
  static inject = [TasksService] as const;

  constructor(private readonly tasks: TasksService) {}

  @Get('/', { schema: { query: ListQuery } })
  list(ctx: Context<InputOf<{ query: typeof ListQuery }>>) {
    return this.tasks.list(ctx.input.query);
  }

  @Get('/:id', { schema: { params: TaskId } })
  get(ctx: Context<InputOf<{ params: typeof TaskId }>>) {
    return this.tasks.get(ctx.input.params.id);
  }

  @Post('/', { schema: { body: CreateTask } })
  create(ctx: Context<InputOf<{ body: typeof CreateTask }>>) {
    const task = this.tasks.create(ctx.input.body);
    return reply(task, { status: 201, headers: { location: `/tasks/${String(task.id)}` } });
  }

  @Patch('/:id', { schema: { params: TaskId, body: UpdateTask } })
  update(ctx: Context<InputOf<{ params: typeof TaskId; body: typeof UpdateTask }>>) {
    return this.tasks.update(ctx.input.params.id, ctx.input.body);
  }

  @Delete('/:id', { schema: { params: TaskId } })
  remove(ctx: Context<InputOf<{ params: typeof TaskId }>>) {
    this.tasks.remove(ctx.input.params.id);
  }
}
