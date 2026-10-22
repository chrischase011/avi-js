# 6. Validation and typed input

> **Status: Planned (Phase 6).** The API for this chapter is designed in Phase 6. This page
> describes the agreed behavior only.

- Validation is optional and plugs in through schema adapters, so you can use the schema library
  you already know.
- Route params, query and body can each have a schema.
- When a schema is present, `ctx.params`, `ctx.query` and `ctx.body` are typed from it.
- Invalid input gets a consistent `400` response that never echoes internals.
- JavaScript users get the same runtime validation without the types.

## Next

[Chapter 7: Running in production](07-production.md).
