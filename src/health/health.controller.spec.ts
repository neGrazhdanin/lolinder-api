import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { HealthController } from './health.controller.js';
import type { HealthChecks, HealthService } from './health.service.js';

function createController(checks: HealthChecks): HealthController {
  return new HealthController({ check: async () => checks } as HealthService);
}

describe('HealthController', () => {
  it('returns ok when every dependency is up', async () => {
    const checks: HealthChecks = { postgres: 'up', redis: 'up' };
    expect(await createController(checks).check()).toEqual({ status: 'ok', checks });
  });

  it('throws SERVICE_UNAVAILABLE with the checks when a dependency is down', async () => {
    const checks: HealthChecks = { postgres: 'up', redis: 'down' };
    const error = await createController(checks)
      .check()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      details: checks,
    });
    expect((error as AppException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
