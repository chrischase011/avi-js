import { Module } from '@avijs/core';
import { Config } from './config.js';
import { PostsModule } from './posts/posts.module.js';
import { UsersModule } from './users/users.module.js';

@Module({ imports: [Config.module, UsersModule, PostsModule] })
export class AppModule {}
