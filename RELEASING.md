# Releasing Avi.js

Releases are manual and deliberate. Nothing is published unless a maintainer starts the release
workflow with `publish` turned on.

## Versioning

- All packages share one version (lockstep), set with `pnpm release:version <version>`.
- [Semantic Versioning](https://semver.org). Before 1.0, minor versions may contain breaking changes;
  every one is listed in `CHANGELOG.md`.
- Git tags start at 1.0.0.

## One-time setup

1. **Package names.** The `@avi` npm scope is provisional. Confirm it is available to you (or choose
   another scope and rename the packages) before the first publish.
2. **npm token.** Create an npm automation token and add it as the `NPM_TOKEN` repository secret.
3. **Protection.** Optionally restrict who can run the Release workflow, for example with a
   protected GitHub environment that requires approval.

## Checklist

1. `main` is green in CI on every platform, including the **Package artifacts** and
   **Dependency audit** jobs.
2. Locally, from a clean checkout:
   ```sh
   pnpm install --frozen-lockfile
   pnpm verify
   pnpm verify:artifacts
   ```
3. Review the public API: the `public-api.test.ts` files list every runtime export. Any change since
   the last release must be in `CHANGELOG.md`, and breaking changes must be marked.
4. Update `CHANGELOG.md`: move "Unreleased" under the new version and date.
5. Set the version: `pnpm release:version <version>`, then commit (`chore: release <version>`).
6. For the first publish only: remove `"private": true` from every `packages/*/package.json`. The
   workflow refuses to publish while any package is private.
7. Push, then run the **Release** workflow with `publish` off. It verifies everything again and
   uploads the tarballs; download and inspect them.
8. Run it again with `publish` on. Packages are published with npm provenance.
9. From 1.0.0 on: tag the release commit `v<version>` and push the tag.
10. Smoke-test from the registry: `npx @avi/cli new check-release && cd check-release && npm install && npm test`.

## If something goes wrong

npm versions cannot be reused. Deprecate a bad version with
`npm deprecate @avi/<name>@<version> "<reason>"` and release a fixed one.
