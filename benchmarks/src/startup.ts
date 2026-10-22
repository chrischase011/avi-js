// Times init() for a large app: module graph checks, singleton creation and route composition.
import {
  createAvi,
  createToken,
  defineController,
  defineModule,
  describeApp,
  type AviModule,
} from '@avijs/core';
import { performance } from 'node:perf_hooks';

const MODULES = Number(process.env['BENCH_MODULES'] ?? 100);
const PROVIDERS = 10;
const ROUTES = 10;
const RUNS = Number(process.env['BENCH_RUNS'] ?? 20);

function buildApp() {
  const Config = createToken<{ prefix: string }>('Config');
  const shared = defineModule({
    name: 'Shared',
    providers: [{ provide: Config, useValue: { prefix: 'svc' } }],
    exports: [Config],
  });

  const modules: AviModule[] = [];
  for (let m = 0; m < MODULES; m++) {
    const tokens = Array.from({ length: PROVIDERS }, (_, p) =>
      createToken<string>(`M${String(m)}P${String(p)}`),
    );
    const providers = tokens.map((token, p) =>
      p === 0
        ? {
            provide: token,
            useFactory: (config: { prefix: string }) => config.prefix,
            inject: [Config],
          }
        : {
            provide: token,
            useFactory: (config: { prefix: string }, previous: string) =>
              `${config.prefix}-${previous}`,
            inject: [Config, tokens[p - 1] as typeof token],
          },
    );
    const last = tokens[PROVIDERS - 1] as (typeof tokens)[number];
    const controller = defineController({
      prefix: `/m${String(m)}`,
      inject: [last],
      routes: (value) =>
        Array.from({ length: ROUTES }, (_, r) => ({
          method: 'GET' as const,
          path: r % 2 === 0 ? `/static${String(r)}` : `/items${String(r)}/:id`,
          handler: () => value,
        })),
    });
    modules.push(
      defineModule({
        name: `M${String(m)}`,
        imports: [shared],
        providers,
        controllers: [controller],
      }),
    );
  }
  const root = defineModule({ name: 'App', imports: modules });
  // With BENCH_MANIFEST=1, init() also verifies a manifest made beforehand.
  const manifest = process.env['BENCH_MANIFEST'] === '1' ? describeApp(root) : undefined;
  return createAvi(manifest ? { manifest } : {}).register(root);
}

const timings: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const start = performance.now();
  const app = buildApp();
  await app.init();
  timings.push(performance.now() - start);
  await app.close();
}

const [cold = 0, ...warm] = timings;
const sorted = [...warm].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)] ?? 0;

console.log(
  `Node ${process.version}: ${String(MODULES)} modules, ${String(MODULES * PROVIDERS)} providers, ${String(MODULES * ROUTES)} routes`,
);
console.log(`define + init, first run (cold): ${cold.toFixed(1)} ms`);
console.log(`define + init, median of next ${String(warm.length)}: ${median.toFixed(1)} ms`);
