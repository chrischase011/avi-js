import { Controller, Get, defineController, defineModule } from '@avijs/core';

@Controller('/items')
class Items {
  @Get('/:id')
  one() {
    return 'item';
  }
}

const health = defineController({
  name: 'Health',
  routes: [{ method: 'GET', path: '/health', handler: () => 'ok' }],
});

const late = defineController({
  name: 'Late',
  inject: [],
  routes: () => [{ method: 'GET', path: '/late', handler: () => 'late' }],
});

const Shared = defineModule({ name: 'Shared' });

export const AppModule = defineModule({
  name: 'AppModule',
  prefix: '/api',
  imports: [Shared],
  controllers: [Items, health, late],
});
