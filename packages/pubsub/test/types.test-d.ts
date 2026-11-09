import { expectTypeOf, it } from 'vitest';
import { defineChannel, type PubSub, type Received } from '../src/index.js';

declare const pubsub: PubSub;
const Tasks = defineChannel<{ id: number; at: Date; tags: string[] }>('tasks');
const Status = defineChannel<'up' | 'down'>('status');
const Created = defineChannel<{ type: 'created'; id: number }>('created');
interface Task {
  readonly id: number;
  readonly at: string;
  readonly tags: readonly string[];
}

it('types messages as their frozen JSON form', () => {
  expectTypeOf<Received<{ id: number; at: Date; tags: string[] }>>().toEqualTypeOf<Task>();
  expectTypeOf(pubsub.subscribe(Tasks)).toEqualTypeOf<AsyncIterableIterator<Task>>();
  expectTypeOf(pubsub.events(Tasks)).toEqualTypeOf<
    AsyncIterableIterator<{ readonly event?: string; readonly data: Task }>
  >();
  pubsub.on(Tasks, (task) => {
    expectTypeOf(task).toEqualTypeOf<Task>();
    expectTypeOf(task.tags).toEqualTypeOf<readonly string[]>();
  });
});

it('checks what is published against the channel', () => {
  void pubsub.publish(Tasks, { id: 1, at: new Date(), tags: [] });
  // @ts-expect-error missing field
  void pubsub.publish(Tasks, { id: 1 });
  // @ts-expect-error wrong type
  void pubsub.publish(Tasks, { id: '1', at: new Date(), tags: [] });
  void pubsub.publish(Status, 'up');
  // @ts-expect-error not one of the channel's values
  void pubsub.publish(Status, 'sideways');
  // @ts-expect-error a type the channel does not carry
  void pubsub.publish(Created, { type: 'deleted', id: 1 });
});
