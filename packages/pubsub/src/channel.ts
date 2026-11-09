declare const messageType: unique symbol;

/** A named channel whose messages have type `T`. Created with `defineChannel<T>()`. */
export interface Channel<T> {
  readonly name: string;
  readonly [messageType]?: T;
}

/** Type of the messages on a channel. */
export type ChannelMessage<C> = C extends Channel<infer T> ? T : never;

export function defineChannel<T>(name: string): Channel<T> {
  if (typeof name !== 'string' || name === '') {
    throw new TypeError('defineChannel needs a non-empty name');
  }
  return Object.freeze({ name });
}

export function channelName(channel: Channel<unknown>, where: string): string {
  const name = (channel as Partial<Channel<unknown>> | null | undefined)?.name;
  if (typeof name !== 'string' || name === '') {
    throw new TypeError(`${where} needs a channel from defineChannel()`);
  }
  return name;
}
