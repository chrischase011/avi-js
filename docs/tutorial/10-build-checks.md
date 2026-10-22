# 10. Build-time checks and manifests

> **Status: Runnable.** Everything on this page works today. The compiler is optional: apps run
> the same without it.

`@avi/compiler` adds two checks you can run in CI or before a deploy. It ships an `avi-compile`
command.

## Checking `static inject` lists

With `@Injectable` or `@Controller`, TypeScript already checks that `static inject` matches the
constructor. Plain classes only get a runtime check of the argument count. `avi-compile check`
type-checks every `static inject` in a project, decorated or not:

```sh
avi-compile check --project tsconfig.json
```

```text
src/users/users.repository.ts:4:20 error AVI004: UsersRepository.inject[0] provides Config, but parameter "db" expects Db
src/users/users.service.ts:9:19 error AVI001: UsersService needs 2 constructor arguments but inject lists 1
src/audit.ts:3:3 warning AVI002: Audit.inject is not an array literal and cannot be checked
2 error(s), 1 warning(s) in static inject lists
```

| Code   | Meaning                                                                    |
| ------ | -------------------------------------------------------------------------- |
| AVI001 | The list is shorter than the constructor's required parameters             |
| AVI002 | The list is built at runtime (a function call, a spread), so it is skipped |
| AVI003 | A token's type could not be worked out                                     |
| AVI004 | A token provides a type the parameter does not accept                      |

The command exits with `1` when there are errors, so CI fails. Subtypes are fine, and optional
parameters may be left out.

## Manifests

A manifest is a JSON description of your app: modules, providers, exports and routes. It is built
**without creating any provider**, so nothing connects to a database at build time.

```sh
tsc -b
avi-compile manifest dist/app.module.js --export AppModule --out avi.manifest.json
```

The command checks the module graph the same way `init()` does, so a missing provider or a cycle
fails the build instead of the deploy. In code, the same description comes from `describeApp`:

```ts
import { describeApp } from '@avi/core';

const manifest = describeApp(AppModule);
// manifest.routes → [{ method: 'GET', path: '/users/:id', module: 'UsersModule', controller: 'UsersController' }, ...]
```

Controllers whose routes come from a `routes` factory only know their routes at runtime. The
manifest lists them under `dynamic`, and the CLI prints a note for each.

### Refusing to start with a stale manifest

Pass the manifest to `createAvi` and `init()` compares it with the app it is about to start:

```ts
import manifest from './avi.manifest.json' with { type: 'json' };

const app = createAvi({ manifest }).register(AppModule);
await app.listen(3000);
```

If a route, provider or module changed since the manifest was written, startup fails and names
the first difference, such as `$.modules[0].controllers[1].routes[1]`. Use this to make sure the
artifact you reviewed is the one you deploy.

## What the compiler does not do

The compiler does not generate code, and a manifest does not make startup faster: verifying it is
extra work (see `benchmarks/README.md`). Generated provider factories are deferred until they
show a measurable benefit; `init()` already takes a few milliseconds for 1,000 providers.

## Next

[Chapter 11: OpenAPI documents](11-openapi.md).
