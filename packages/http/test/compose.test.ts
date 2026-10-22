import { describe, expect, it } from 'vitest';
import { HttpError, compose, type Context, type Guard, type Middleware } from '../src/index.js';

const ctx = {} as Context;

function tracer(log: string[], name: string): Middleware {
  return async (_ctx, next) => {
    log.push(`${name} in`);
    const result = await next();
    log.push(`${name} out`);
    return result;
  };
}

describe('compose', () => {
  it('returns the handler itself when there is nothing to compose', () => {
    const handler = () => 'x';
    expect(compose([], [], handler)).toBe(handler);
  });

  it('runs middleware as an onion, then guards, then the handler', async () => {
    const log: string[] = [];
    const guard: Guard = () => {
      log.push('guard');
      return true;
    };
    const run = compose([tracer(log, 'a'), tracer(log, 'b')], [guard], () => {
      log.push('handler');
      return 'done';
    });

    expect(await run(ctx)).toBe('done');
    expect(log).toEqual(['a in', 'b in', 'guard', 'handler', 'b out', 'a out']);
  });

  it('lets middleware replace the result', async () => {
    const wrap: Middleware = async (_ctx, next) => ({ data: await next() });
    expect(await compose([wrap], [], () => 42)(ctx)).toEqual({ data: 42 });
  });

  it('short-circuits when middleware does not call next', async () => {
    let reached = false;
    const run = compose([() => 'cached'], [], () => {
      reached = true;
    });
    expect(await run(ctx)).toBe('cached');
    expect(reached).toBe(false);
  });

  it('rejects calling next twice', async () => {
    const twice: Middleware = async (_ctx, next) => {
      await next();
      return next();
    };
    await expect(compose([twice], [], () => 1)(ctx)).rejects.toThrow(
      'next() was called more than once',
    );
  });

  it('answers 403 when a guard returns anything but true', async () => {
    for (const result of [false, 'yes' as unknown as boolean, Promise.resolve(false)]) {
      const run = compose([], [() => result], () => 'secret');
      await expect(run(ctx)).rejects.toMatchObject({ status: 403 });
    }
  });

  it('stops at the first guard that refuses', async () => {
    const log: string[] = [];
    const run = compose(
      [],
      [
        () => {
          log.push('first');
          return false;
        },
        () => {
          log.push('second');
          return true;
        },
      ],
      () => 'x',
    );
    await expect(run(ctx)).rejects.toBeInstanceOf(HttpError);
    expect(log).toEqual(['first']);
  });

  it.each<[string, Middleware[], Guard[], () => unknown]>([
    [
      'sync middleware',
      [
        () => {
          throw new Error('boom');
        },
      ],
      [],
      () => 1,
    ],
    ['async middleware', [() => Promise.reject(new Error('boom'))], [], () => 1],
    [
      'a sync guard',
      [],
      [
        () => {
          throw new Error('boom');
        },
      ],
      () => 1,
    ],
    ['an async guard', [], [() => Promise.reject(new Error('boom'))], () => 1],
    [
      'a sync handler',
      [(_c, next) => next()],
      [],
      () => {
        throw new Error('boom');
      },
    ],
    ['an async handler', [(_c, next) => next()], [], () => Promise.reject(new Error('boom'))],
  ])('turns errors from %s into a rejection', async (_, middleware, guards, handler) => {
    await expect(compose(middleware, guards, handler)(ctx)).rejects.toThrow('boom');
  });

  it('lets middleware catch downstream errors', async () => {
    const rescue: Middleware = async (_ctx, next) => {
      try {
        return await next();
      } catch {
        return 'recovered';
      }
    };
    const run = compose([rescue], [() => false], () => 'x');
    expect(await run(ctx)).toBe('recovered');
  });
});
