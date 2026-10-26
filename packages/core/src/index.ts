import './decorators.js';

export { AviFactory, createAvi } from './app.js';
export type { AviApp, AviOptions, RouteInfo } from './app.js';
export { ConfigError, defineConfig } from './config.js';
export type { ConfigOptions, ConfigToken } from './config.js';
export { defineController } from './controller.js';
export { describeApp } from './describe.js';
export type {
  AppDescription,
  ControllerDescription,
  ModuleSummary,
  RouteSummary,
} from './describe.js';
export type { ControllerDefinition, ControllerOptions, StaticRoute } from './controller.js';
export {
  Controller,
  Delete,
  Get,
  Head,
  Injectable,
  Module,
  Options,
  Patch,
  Post,
  Put,
  UseGuards,
  UseMiddleware,
} from './decorators.js';
export type { CheckInject } from './decorators.js';
export { defineModule } from './module.js';
export type { AviModule, ModuleOptions, ModuleRef } from './module.js';
export { route } from './pipeline.js';
export { APP, REQUEST } from './request.js';
export type {
  GuardClass,
  GuardRef,
  MiddlewareClass,
  MiddlewareRef,
  Route,
  RouteContext,
  RouteDocs,
  RouteOf,
  TypedRoute,
} from './pipeline.js';
export type {
  InferInput,
  InferOutput,
  InputOf,
  PathParams,
  RouteSchema,
  StandardSchemaV1,
  ValidationIssue,
} from '@avijs/validation';

export { HTTP_METHODS, HttpError, jsonLogger, logRequests, reply, sse } from '@avijs/http';
export type {
  AviState,
  Context,
  ErrorHandler,
  Guard,
  Handler,
  HttpErrorOptions,
  HttpMethod,
  JsonLoggerOptions,
  LogFields,
  LogRequestsOptions,
  Logger,
  Middleware,
  Next,
  NoInput,
  Params,
  Reply,
  ReplyInit,
  RequestHook,
  RequestIdOptions,
  ResponseInfo,
  RouteDefinition,
  ServerSentEvent,
  SseOptions,
  SseSource,
} from '@avijs/http';
export { createToken, defineFactory } from '@avijs/di';
export { defineHook } from './hooks.js';
export type { HookDefinition } from './hooks.js';
export type {
  Class,
  ClassProvider,
  Constructor,
  FactoryProvider,
  InjectionToken,
  Provider,
  ResolveTokens,
  Scope,
  Token,
  TokenType,
  TypedFactoryProvider,
  ValueProvider,
} from '@avijs/di';
export type { Endpoint, Jsonify, MethodEndpoint, ResponseBody, RouteEndpoint } from './endpoint.js';
