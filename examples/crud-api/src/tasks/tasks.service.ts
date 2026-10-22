import { HttpError, Injectable } from '@avijs/core';
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from './task.schema.js';
import { TASKS_REPOSITORY, type TasksRepository } from './tasks.repository.js';

@Injectable()
export class TasksService {
  static inject = [TASKS_REPOSITORY] as const;

  constructor(private readonly tasks: TasksRepository) {}

  list(query: ListTasksQuery) {
    return this.tasks.list(query);
  }

  get(id: number) {
    const task = this.tasks.find(id);
    if (!task) throw new HttpError(404, `Task ${String(id)} not found`);
    return task;
  }

  create(input: CreateTaskInput) {
    return this.tasks.create(input);
  }

  update(id: number, input: UpdateTaskInput) {
    const task = this.tasks.update(id, input);
    if (!task) throw new HttpError(404, `Task ${String(id)} not found`);
    return task;
  }

  remove(id: number) {
    if (!this.tasks.remove(id)) throw new HttpError(404, `Task ${String(id)} not found`);
  }
}
