// NestJS with the same routes and responses as the Avi server, on Express or Fastify (argv[3]).
// The benchmarks compile with standard decorators, so Nest's legacy decorators are applied as
// plain calls, which is what TypeScript emits for them.
import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Module,
  Param,
  Post,
  RequestMapping,
  RequestMethod,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LIST, TOKEN } from '../data.js';
import { FILLER } from '../routes.js';

const fastify = process.argv[3] === 'fastify';

class AppController {
  hello() {
    return { hello: 'world' };
  }
  user(id: string) {
    return { id };
  }
  echo(body: unknown) {
    return body;
  }
  list() {
    return LIST;
  }
  orders(body: object) {
    return { id: 1, ...body };
  }
}

class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    return req.headers['authorization'] === TOKEN;
  }
}
Injectable()(AuthGuard);

type Decorator = (target: object, key: string, descriptor: PropertyDescriptor) => void;
const proto = AppController.prototype as unknown as Record<string, unknown>;

function decorate(name: string, methods: Decorator[], param?: ParameterDecorator): void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, name) as PropertyDescriptor;
  param?.(proto, name, 0);
  for (const method of methods) method(proto, name, descriptor);
}

decorate('hello', [Get('/')]);
decorate('user', [Get('/users/:id')], Param('id'));
// Nest answers POST with 201 by default; the other servers send 200.
decorate('echo', [Post('/echo'), HttpCode(200)], Body());
decorate('list', [Get('/list')]);
decorate(
  'orders',
  [Post('/orders'), HttpCode(201), Header('location', '/orders/1'), UseGuards(AuthGuard)],
  Body(),
);
FILLER.forEach(([method, path], i) => {
  const name = `filler${String(i)}`;
  Object.defineProperty(proto, name, { value: () => null, writable: true, configurable: true });
  // Express 5 needs a named wildcard; Fastify takes a bare one.
  const route = fastify ? path : path.replace(/\*$/, '*path');
  decorate(name, [RequestMapping({ path: route, method: RequestMethod[method] })]);
});
Controller()(AppController);

// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are empty classes
class AppModule {}
Module({ controllers: [AppController] })(AppModule);

const app: INestApplication = fastify
  ? await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false })
  : await NestFactory.create(AppModule, { logger: false });

await app.listen(Number(process.argv[2] ?? 0), '127.0.0.1');
process.send?.({ port: ((app.getHttpServer() as Server).address() as AddressInfo).port });
process.on('disconnect', () => {
  void app.close().then(() => process.exit(0));
});
