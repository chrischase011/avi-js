# @avijs/cli

The avi command for Avi.js projects.

```sh
npm install -D @avijs/cli
```

| Command                   | What it does                                                                      |
| ------------------------- | --------------------------------------------------------------------------------- |
| `avi new <name>`          | Creates a project (`--template modular` or `minimal`). Also `npm create avi`      |
| `avi g <kind> <path>`     | Adds a `module`, `controller` or `service` and registers it in the nearest module |
| `avi dev`                 | Compiles, then recompiles and restarts on every change                            |
| `avi check`               | Type-checks every `static inject` list                                            |
| `avi manifest <entry.js>` | Writes the app's modules, providers and routes as JSON                            |

Part of [Avi.js](https://github.com/chrischase011/avi-js), a TypeScript framework for Node.js with
modules, controllers and dependency injection, without `reflect-metadata`. See the
[tutorial](https://github.com/chrischase011/avi-js/blob/main/docs/tutorial/README.md) to get started.

Requires Node.js 22.12 or newer. MIT licensed.
