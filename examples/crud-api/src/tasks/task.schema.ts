import * as v from 'valibot';

export const Status = v.picklist(['todo', 'doing', 'done']);

export const CreateTask = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1, 'title is required'), v.maxLength(200)),
  status: v.optional(Status, 'todo'),
});

// Every field optional, at least one present.
export const UpdateTask = v.pipe(
  v.partial(CreateTask),
  v.check((input) => Object.keys(input).length > 0, 'nothing to update'),
);

export const TaskId = v.object({
  id: v.pipe(v.string(), v.regex(/^\d+$/, 'id must be a number'), v.transform(Number)),
});

const Count = (fallback: string) =>
  v.optional(v.pipe(v.string(), v.regex(/^\d+$/), v.transform(Number)), fallback);

export const ListQuery = v.object({
  status: v.optional(Status),
  limit: v.pipe(Count('20'), v.maxValue(100)),
  offset: Count('0'),
});

export type Task = { id: number; createdAt: string } & v.InferOutput<typeof CreateTask>;
export type CreateTaskInput = v.InferOutput<typeof CreateTask>;
export type UpdateTaskInput = v.InferOutput<typeof UpdateTask>;
export type ListTasksQuery = v.InferOutput<typeof ListQuery>;
