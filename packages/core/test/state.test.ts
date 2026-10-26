import { describe, expect, it, vi } from 'vitest';
import { createAvi, defineController, route, type Guard } from '../src/index.js';

declare module '../src/index.js' {
  interface AviState {
    account?: { id: string };
  }
}

const signedIn: Guard = (ctx) => {
  ctx.state.account = { id: 'a1' };
  return true;
};

describe('ctx.need', () => {
  it('returns what a guard set, and fails loudly on a route without the guard', async () => {
    const error = vi.fn();
    const app = createAvi({ startupSummary: false, logger: { error } }).register({
      controllers: [
        defineController({
          routes: [
            route({
              method: 'GET',
              path: '/me',
              guards: [signedIn],
              handler: (ctx) => ctx.need('account').id,
            }),
            route({ method: 'GET', path: '/forgot', handler: (ctx) => ctx.need('account').id }),
          ],
        }),
      ],
    });
    const { port } = await app.listen(0, '127.0.0.1');
    try {
      const base = `http://127.0.0.1:${String(port)}`;
      expect(await (await fetch(`${base}/me`)).text()).toBe('a1');

      const forgot = await fetch(`${base}/forgot`);
      expect(forgot.status).toBe(500);
      // The reason goes to the log, not to the client.
      expect(await forgot.text()).not.toContain('guard');
      expect(String(error.mock.calls[0]?.[1] ?? error.mock.calls[0]?.[0])).toContain(
        'ctx.state.account is not set',
      );
    } finally {
      await app.close();
    }
  });
});
