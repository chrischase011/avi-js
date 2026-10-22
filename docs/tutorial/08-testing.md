# 8. Testing your app

> **Status: Planned (Phase 9).** The testing helpers are designed in Phase 9. This page
> describes the agreed behavior only.

- Each `createAvi()` app is self-contained, so tests can create one per test without shared
  state.
- You can replace any provider with a test double by registering a different provider for the
  same token.
- Testing helpers will let you send requests to an app without opening a real port.

Until then, the workspace itself is a working example: see `packages/*/test` for runtime tests
and type tests written with Vitest.
