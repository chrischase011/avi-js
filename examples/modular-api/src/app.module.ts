import { Module } from '@avijs/core';
import { HealthController } from './common/health.controller.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({ imports: [UsersModule], controllers: [HealthController] })
export class AppModule {}
