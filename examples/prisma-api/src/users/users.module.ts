import { Module } from '@avijs/core';
import { PrismaModule } from '../prisma.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({ imports: [PrismaModule], controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
