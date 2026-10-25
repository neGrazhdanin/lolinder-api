import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HttpErrorFilter } from './common/errors/http-error.filter.js';
import { createSchemaValidationPipe } from './common/validation/schema-validation.pipe.js';
import { CoreModule } from './core/core.module.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { StaticDataModule } from './static-data/static-data.module.js';

@Module({
  imports: [
    CoreModule,
    InfraModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    HealthModule,
    StaticDataModule,
    RealtimeModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpErrorFilter },
    { provide: APP_PIPE, useFactory: createSchemaValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
