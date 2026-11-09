import type { TokenType } from '@avijs/core';
import { clusterAdapter, defineChannel, definePubSub } from '@avijs/pubsub';

// Through the cluster primary, so every worker's streams hear every worker's events.
export const PubSub = definePubSub({ adapter: clusterAdapter() });
export type PubSub = TokenType<typeof PubSub>;

export const EmailEvents = defineChannel<{ id: string; to: string }>('emails');
