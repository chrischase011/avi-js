import { Module } from '@avijs/core';
import { InMemoryTasksRepository, TASKS_REPOSITORY } from './tasks.repository.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  controllers: [TasksController],
  providers: [TasksService, { provide: TASKS_REPOSITORY, useClass: InMemoryTasksRepository }],
})
export class TasksModule {}
