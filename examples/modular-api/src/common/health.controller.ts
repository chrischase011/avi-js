import { Controller, Get } from '@avijs/core';

@Controller()
export class HealthController {
  @Get('/health')
  check() {
    return 'ok';
  }
}
