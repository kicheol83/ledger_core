import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  @Get('live')
  live(): { status: 'ok'; uptimeSeconds: number } {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }
}
