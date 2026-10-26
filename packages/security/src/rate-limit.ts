import { HttpError, type Context, type Guard, type Logger, type RequestHook } from '@avijs/http';

/** Counts requests per key in fixed windows. Implement it to share counts, for example in Redis. */
export interface RateLimitStore {
  /** Counts one request for `key` and returns the window's count and end time (ms since epoch). */
  increment(key: string, window: number): RateLimitResult | Promise<RateLimitResult>;
}

export interface RateLimitResult {
  readonly count: number;
  readonly resetAt: number;
}

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in ms. */
  window: number;
  /** What to count by. Default: the client IP, `ctx.ip`. */
  key?: (ctx: Context) => string;
  /** Default: a new in-memory store for this limiter. */
  store?: RateLimitStore;
  /** When the store fails: let requests through (default) or reject them with `503`. */
  onStoreError?: 'allow' | 'deny';
  /** Receives store failures. Default: `console.error`. */
  logger?: Pick<Logger, 'error'>;
}

/** A rate limit as an `onRequest` hook, with `.guard` to limit single routes instead. */
export interface RateLimiter extends RequestHook {
  readonly guard: Guard;
}

/**
 * Limits each client to `limit` requests per `window`. Over the limit: `429` with
 * `Retry-After`. Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and
 * `RateLimit-Reset`, so clients can slow down first.
 */
export function rateLimit(options: RateLimitOptions): RateLimiter {
  const limit = positive('limit', options.limit);
  const window = positive('window', options.window);
  const store = options.store ?? memoryStore();
  const key = options.key ?? ((ctx: Context) => ctx.ip);
  const deny = options.onStoreError === 'deny';
  const logger = options.logger ?? {
    error: (message: string, error: unknown) => {
      console.error(message, error);
    },
  };

  const apply = (ctx: Context, { count, resetAt }: RateLimitResult): void => {
    const seconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
    ctx.setHeader('ratelimit-limit', limit);
    ctx.setHeader('ratelimit-remaining', Math.max(0, limit - count));
    ctx.setHeader('ratelimit-reset', seconds);
    if (count > limit) {
      throw new HttpError(429, 'Too many requests', {
        headers: { 'retry-after': String(seconds) },
      });
    }
  };
  const failed = (ctx: Context, error: unknown): void => {
    logger.error(`Rate limit store failed: ${ctx.method} ${ctx.path}`, error);
    if (deny) throw new HttpError(503, 'Service unavailable');
  };

  const check = (ctx: Context): void | Promise<void> => {
    let result: RateLimitResult | Promise<RateLimitResult>;
    try {
      result = store.increment(key(ctx), window);
    } catch (error) {
      failed(ctx, error);
      return;
    }
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          apply(ctx, value);
        },
        (error: unknown) => {
          failed(ctx, error);
        },
      );
    }
    apply(ctx, result);
  };

  const hook = (ctx: Context) => check(ctx);
  const guard: Guard = (ctx) => {
    const pending = check(ctx);
    return pending ? pending.then(() => true) : true;
  };
  return Object.assign(hook, { guard });
}

export interface MemoryStoreOptions {
  /**
   * Most keys tracked at once. When full, the least recently used key is dropped, so a flood of
   * new clients cannot use unbounded memory. Default: 100 000.
   */
  maxKeys?: number;
}

/** A store that counts synchronously, in this process. */
export interface MemoryStore extends RateLimitStore {
  increment(key: string, window: number): RateLimitResult;
}

/** Counts in this process only. For several processes or servers, use a shared store. */
export function memoryStore(options: MemoryStoreOptions = {}): MemoryStore {
  const maxKeys = positive('maxKeys', options.maxKeys ?? 100_000);
  // Least recently used first: every increment moves its key to the end.
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    increment(key, window) {
      const now = Date.now();
      const current = windows.get(key);
      if (current) windows.delete(key);
      const entry =
        current && current.resetAt > now
          ? { count: current.count + 1, resetAt: current.resetAt }
          : { count: 1, resetAt: now + window };
      windows.set(key, entry);
      // Over the cap, the least recently used key goes. Pushing out a key that is still in use
      // takes more new keys than the store holds between two of its requests.
      if (windows.size > maxKeys) {
        const oldest = windows.keys().next();
        if (!oldest.done) windows.delete(oldest.value);
      }
      return { count: entry.count, resetAt: entry.resetAt };
    },
  };
}

function positive(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`rateLimit: ${name} must be a positive integer, got ${String(value)}`);
  }
  return value;
}
