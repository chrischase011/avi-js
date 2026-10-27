import { AviFactory, Module } from '@avijs/core';
import { Config } from './config.js';
import './db.js';
import './repo.js';
import { UsersController } from './users/users.controller.js';

@Module({ imports: [Config.module], controllers: [UsersController] })
export class AppModule {}

await AviFactory.create(AppModule);
