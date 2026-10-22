import { Controller, Get } from '@avi/core';

@Controller()
export class HealthController {
  @Get('/health')
  check() {
    return 'ok';
  }
}
