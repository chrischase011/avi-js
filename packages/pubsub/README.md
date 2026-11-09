# @avijs/pubsub

Typed publish and subscribe for Avi.js. Live updates reach every client, whichever process
serves it: in memory for one process, across `cluster()` workers, or through Redis across machines.

```sh
npm install @avijs/pubsub
```

```ts
import { sse } from '@avijs/core';
import { clusterAdapter, defineChannel, definePubSub } from '@avijs/pubsub';
import type { TokenType } from '@avijs/core';

export const PubSub = definePubSub({ adapter: clusterAdapter() });
export type PubSub = TokenType<typeof PubSub>;
export const TaskEvents = defineChannel<{ id: string; status: string }>('tasks');

// In a service: await this.pubsub.publish(TaskEvents, { id, status: 'done' });
// In a controller: return sse(ctx, (signal) => this.pubsub.events(TaskEvents, signal));
```

Part of [Avi.js](https://github.com/chrischase011/avi-js), a TypeScript framework for Node.js with
modules, controllers and dependency injection, without `reflect-metadata`. See the
[real-time chapter](https://github.com/chrischase011/avi-js/blob/main/docs/tutorial/18-realtime.md)
of the tutorial.

Requires Node.js 22.12 or newer. MIT licensed.
