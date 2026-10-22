import { createToken } from '@avijs/core';
import type { CreateTaskInput, ListTasksQuery, Task, UpdateTaskInput } from './task.schema.js';

/** Storage for tasks. Swap the in-memory one for a database without touching the service. */
export interface TasksRepository {
  list(query: ListTasksQuery): { items: Task[]; total: number };
  find(id: number): Task | undefined;
  create(input: CreateTaskInput): Task;
  update(id: number, input: UpdateTaskInput): Task | undefined;
  remove(id: number): boolean;
}

export const TASKS_REPOSITORY = createToken<TasksRepository>('TasksRepository');

export class InMemoryTasksRepository implements TasksRepository {
  readonly #tasks = new Map<number, Task>();
  #nextId = 1;

  list({ status, limit, offset }: ListTasksQuery) {
    const all = [...this.#tasks.values()].filter((task) => !status || task.status === status);
    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  find(id: number) {
    return this.#tasks.get(id);
  }

  create(input: CreateTaskInput) {
    const task: Task = { id: this.#nextId++, createdAt: new Date().toISOString(), ...input };
    this.#tasks.set(task.id, task);
    return task;
  }

  update(id: number, input: UpdateTaskInput) {
    const task = this.#tasks.get(id);
    if (!task) return undefined;
    const updated = { ...task, ...input };
    this.#tasks.set(id, updated);
    return updated;
  }

  remove(id: number) {
    return this.#tasks.delete(id);
  }
}
