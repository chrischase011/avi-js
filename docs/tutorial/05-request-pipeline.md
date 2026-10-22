# 5. Middleware, guards and errors

> **Status: Planned (Phase 5).** The API for this chapter is designed in Phase 5. This page
> describes the agreed behavior only.

## The request pipeline

Every request passes through the same steps, in this order:

```text
route match → middleware → guards → validation → handler → serialization → response
```

- **Middleware** runs code around a request: logging, timing, headers.
- **Guards** decide whether the request may continue: authentication, roles.
- **Validation** checks params, query and body before your handler sees them (Chapter 6).

Each route's chain is assembled once at startup, not on every request.

## One place for errors

An error thrown anywhere in the pipeline, sync or async, goes to a single error boundary. It turns
the error into a safe HTTP response and logs the details. Errors are never silently swallowed.

## Request isolation

Each request gets its own `ctx`. State you attach to it cannot leak into another request, even
under heavy concurrency.

## Next

[Chapter 6: Validation](06-validation.md).
