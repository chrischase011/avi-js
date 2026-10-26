import { afterEach, describe, expect, it } from 'vitest';
import type { ServerOptions } from '../src/index.js';
import { startServer, type TestServer } from './helpers.js';

let current: TestServer | undefined;

afterEach(async () => {
  await current?.server.close();
  current = undefined;
});

async function ipFor(options: ServerOptions, forwarded?: string): Promise<string> {
  current = await startServer([{ method: 'GET', path: '/', handler: (ctx) => ctx.ip }], options);
  const res = await fetch(current.url, {
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  });
  return res.text();
}

const LOCAL = /^(::ffff:)?127\.0\.0\.1$/;

describe('ctx.ip', () => {
  it('is the socket address, ignoring X-Forwarded-For by default', async () => {
    expect(await ipFor({})).toMatch(LOCAL);
    expect(await ipFor({}, '1.2.3.4')).toMatch(LOCAL);
  });

  it('counts trusted proxies back from the socket', async () => {
    // client 9.9.9.9 → proxy 10.0.0.1 → proxy 10.0.0.2 → app
    expect(await ipFor({ trustProxy: 1 }, '9.9.9.9, 10.0.0.1')).toBe('10.0.0.1');
    expect(await ipFor({ trustProxy: 2 }, '9.9.9.9, 10.0.0.1')).toBe('9.9.9.9');
  });

  it('stops at the leftmost address when told to trust more hops than there are', async () => {
    expect(await ipFor({ trustProxy: 5 }, ' 9.9.9.9 ,10.0.0.1,')).toBe('9.9.9.9');
    expect(await ipFor({ trustProxy: 1 })).toMatch(LOCAL);
  });

  it('drops ports and falls back to the socket for anything that is not an address', async () => {
    // Some proxies add the port, which would give every connection its own rate-limit key.
    expect(await ipFor({ trustProxy: 1 }, '1.2.3.4:5555')).toBe('1.2.3.4');
    expect(await ipFor({ trustProxy: 1 }, '[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(await ipFor({ trustProxy: 1 }, '2001:db8::1')).toBe('2001:db8::1');
    for (const junk of ['garbage<>', 'unknown', '1.2.3.4.5', '999.1.1.1']) {
      expect(await ipFor({ trustProxy: 1 }, junk), junk).toMatch(LOCAL);
    }
  });

  it('rejects an invalid trustProxy', async () => {
    await expect(startServer([], { trustProxy: -1 })).rejects.toThrow('trustProxy');
  });
});
