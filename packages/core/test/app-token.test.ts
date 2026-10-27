import { describe, expect, it } from 'vitest';
import {
  APP,
  createAvi,
  createToken,
  defineFactory,
  defineHook,
  describeApp,
  type AviApp,
} from '../src/index.js';

describe('APP', () => {
  const Routes = createToken<() => string[]>('Routes');
  const providers = [
    defineFactory({
      provide: Routes,
      inject: [APP],
      useFactory: (app) => () => app.routes().map((r) => `${r.method} ${r.path}`),
    }),
  ];

  it('injects the app itself', async () => {
    const app: AviApp = createAvi({ startupSummary: false }).register({ providers });
    await app.init();
    try {
      expect(app.get(Routes)()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('resolves in describeApp, which creates no app', () => {
    expect(() => describeApp({ providers })).not.toThrow();
  });
});

describe('APP view', () => {
  it('gives routes() and nothing else, also through app.get and hooks', async () => {
    const seen: unknown[] = [];
    const app = createAvi({
      startupSummary: false,
      onRequest: [
        defineHook({
          inject: [APP],
          create: (view) => {
            seen.push(view);
            return () => undefined;
          },
        }),
      ],
    }).register({});
    await app.init();
    try {
      const view = app.get(APP);
      expect(Object.keys(view)).toEqual(['routes']);
      expect(view).not.toBe(app);
      expect(seen).toEqual([view]);
      expect(view.routes()).toEqual(app.routes());
    } finally {
      await app.close();
    }
  });
});
