# Avi.js tutorial

This tutorial teaches Avi.js by building a small API, one concept per chapter. It is written for
Node.js and TypeScript developers who know Express. NestJS experience helps but is not required.

Avi.js is being built in phases, and this tutorial grows with it. Every chapter starts with a
status line:

- **Runnable**: everything in the chapter works today.
- **Partly runnable**: the chapter says which parts work today and which are planned.
- **Planned (Phase N)**: the chapter shows the target API. The code does not run yet. It is
  rewritten into tested, runnable form when that phase ships.

| #                            | Chapter                                    | Status            |
| ---------------------------- | ------------------------------------------ | ----------------- |
| [0](00-getting-started.md)   | Getting started with the workspace         | Runnable          |
| [1](01-first-app.md)         | Your first app                             | Runnable          |
| [2](02-routing.md)           | Routing: params, query, precedence         | Runnable          |
| [3](03-modules-and-di.md)    | Modules and dependency injection           | Runnable          |
| [4](04-controllers.md)       | Controllers: explicit and decorator styles | Runnable          |
| [5](05-request-pipeline.md)  | Middleware, guards and errors              | Runnable          |
| [6](06-validation.md)        | Validation and typed input                 | Planned (Phase 6) |
| [7](07-production.md)        | Running in production                      | Partly runnable   |
| [8](08-testing.md)           | Testing your app                           | Partly runnable   |
| [9](09-project-structure.md) | Project structure: modular and minimal     | Partly runnable   |

Throughout the tutorial you build **Greeter**, a small API with a users resource and a greeting
service, so each chapter adds to the previous one.
