---
layout: home
title: Avi.js, a TypeScript framework for Node.js
titleTemplate: false
description: A TypeScript framework for Node.js with modules, controllers and dependency injection, without reflect-metadata. Decorators or plain functions, one engine.

hero:
  name: Avi.js
  text: Structure without the overhead.
  tagline: A TypeScript framework for Node.js with modules, controllers and dependency injection. No reflect-metadata, no Express underneath.
  image:
    light: /mark.svg
    dark: /mark-dark.svg
    alt: Avi.js
  actions:
    - theme: brand
      text: Get started
      link: /tutorial/00-getting-started
    - theme: alt
      text: Examples
      link: /examples
    - theme: alt
      text: GitHub
      link: https://github.com/chrischase011/avi-js

features:
  - title: Two styles, one engine
    details: Write controllers with decorators or with plain objects and functions. Both turn into the same definitions and behave identically.
  - title: Explicit by design
    details: Each class lists its dependencies in code. No reflect-metadata, emitDecoratorMetadata or experimentalDecorators. What you read is what runs.
  - title: Catch configuration errors early
    details: Missing providers, invalid exports, dependency cycles and conflicting routes are detected during initialization, before the server accepts requests.
  - title: Safe by default
    details: Bounded request bodies, sanitized error responses, abort-aware handlers and graceful shutdown are built in, not plugins.
  - title: Small and modular
    details: Runs on native node:http. DI, HTTP, validation, security and testing are separate packages you add when you need them.
  - title: Tools included
    details: npm create avi, generators for modules, controllers and services, a test client, Standard Schema validation and OpenAPI documents.
---

## Start in a minute

```sh
npm create avi@latest my-api
cd my-api
npm install
npm run dev
```

## Pick your style

::: code-group

```ts [Decorators]
import { AviFactory, Controller, Get, Injectable, Module } from '@avijs/core';

@Injectable()
class UsersService {
  findAll() {
    return [{ id: 1, name: 'Shiela' }];
  }
}

@Controller('/users')
class UsersController {
  static inject = [UsersService] as const;
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
class AppModule {}

const app = await AviFactory.create(AppModule);
await app.listen(3000);
```

```ts [Explicit]
import { createAvi, defineController } from '@avijs/core';

class UsersService {
  findAll() {
    return [{ id: 1, name: 'Shiela' }];
  }
}

const users = defineController({
  prefix: '/users',
  inject: [UsersService],
  routes: (service) => [{ method: 'GET', path: '/', handler: () => service.findAll() }],
});

const app = createAvi().register({ providers: [UsersService], controllers: [users] });
await app.listen(3000);
```

:::

Avi.js is in early development (0.x): the API may still change between minor versions before 1.0.
