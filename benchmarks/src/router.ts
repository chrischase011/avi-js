import { Router } from '@avijs/http';
import { bench, do_not_optimize, run, summary } from 'mitata';
import { PROBES, ROUTES } from './routes.js';

const router = new Router();
router.add(ROUTES.map(([method, path]) => ({ method, path, handler: () => null })));

for (const [, path] of PROBES) {
  const kind = router.find('GET', path).kind;
  if (kind !== 'found' && !path.startsWith('/nope')) throw new Error(`Probe ${path}: ${kind}`);
}

console.log(`Router.find with ${String(ROUTES.length)} routes, Node ${process.version}\n`);

summary(() => {
  for (const [name, path] of PROBES) {
    bench(name, () => {
      do_not_optimize(router.find('GET', path));
    });
  }
});

await run();
