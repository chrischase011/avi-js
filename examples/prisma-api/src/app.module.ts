import { Module } from '@avijs/core';
import { PostsModule } from './posts/posts.module.js';
import { UsersModule } from './users/users.module.js';

@Module({ imports: [UsersModule, PostsModule] })
export class AppModule {}
