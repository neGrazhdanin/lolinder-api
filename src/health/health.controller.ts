import { Controller, Get, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { type HealthChecks, HealthService } from './health.service.js';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(): Promise<{ status: 'ok'; checks: HealthChecks }> {
    const checks = await this.health.check();
    if (Object.values(checks).includes('down')) {
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, checks);
    }
    return { status: 'ok', checks };
  }
}
