import { describe, expect, it } from 'vitest';
import {
  APP,
  createAvi,
  createToken,
  defineFactory,
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
