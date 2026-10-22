import { Module } from '@avijs/core';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({ controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
