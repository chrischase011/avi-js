/** Hands a message that arrived on `channel` to this process's subscribers. */
export type Deliver = (channel: string, message: string) => void;

/** One app's link to a broker. Messages are JSON text. */
export interface PubSubConnection {
  /** Sends `message` to every subscriber of `channel`, in every process the broker reaches. */
  publish(channel: string, message: string): Promise<void> | void;
  /** Called when the first local subscriber of `channel` arrives. */
  subscribe(channel: string): Promise<void> | void;
  /** Called when the last local subscriber of `channel` leaves. */
  unsubscribe(channel: string): Promise<void> | void;
  /** Stops delivering. Clients passed in by the app stay open; the app owns them. */
  close(): Promise<void> | void;
}

/** A broker: in memory, across `cluster()` workers, or a server such as Redis. */
export interface PubSubAdapter {
  /** Called once per app, when its pub/sub provider is created. */
  connect(deliver: Deliver): Promise<PubSubConnection> | PubSubConnection;
}

/**
 * Delivers within this process. Every app connected to the same adapter shares it, like apps on
 * one Redis server.
 */
export function memoryAdapter(): PubSubAdapter {
  const listeners = new Set<Deliver>();
  return {
    connect(deliver) {
      listeners.add(deliver);
      return {
        publish(channel, message) {
          // Later, like a real broker: subscribers never run inside publish().
          for (const listener of listeners)
            queueMicrotask(() => {
              listener(channel, message);
            });
        },
        subscribe: () => undefined,
        unsubscribe: () => undefined,
        close() {
          listeners.delete(deliver);
        },
      };
    },
  };
}
