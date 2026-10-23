import { Module, defineConfig, defineModule } from '@avijs/core';
import * as v from 'valibot';
import { ItemsModule } from './items/items.module.js';
import { UsersController } from './users/users.controller.js';

const Config = defineConfig(v.object({ PORT: v.optional(v.string(), '3000') }));

const UsersModule = defineModule({ name: 'UsersModule', controllers: [UsersController] });

@Module({ imports: [Config.module, UsersModule, ItemsModule] })
export class AppModule {}
