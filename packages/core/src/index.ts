import './decorators.js';

export { AviFactory, createAvi } from './app.js';
export type { AviApp, AviOptions, RouteInfo } from './app.js';
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
export { REQUEST } from './request.js';
export type {
  GuardClass,
  GuardRef,
  MiddlewareClass,
  MiddlewareRef,
  Route,
  RouteDocs,
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

export { HTTP_METHODS, HttpError, reply } from '@avijs/http';
export type {
  AviState,
  Context,
  ErrorHandler,
  Guard,
  Handler,
  HttpErrorOptions,
  HttpMethod,
  Logger,
  Middleware,
  Next,
  NoInput,
  Params,
  Reply,
  ReplyInit,
  RequestHook,
  ResponseInfo,
  RouteDefinition,
} from '@avijs/http';
export { createToken } from '@avijs/di';
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
  ValueProvider,
} from '@avijs/di';
