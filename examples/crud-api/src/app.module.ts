import { Module } from '@avijs/core';
import { TasksModule } from './tasks/tasks.module.js';

@Module({ imports: [TasksModule] })
export class AppModule {}
