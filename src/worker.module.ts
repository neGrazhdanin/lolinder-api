import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { InfraModule } from './infra/infra.module.js';
import { RiotModule } from './riot/riot.module.js';

@Module({
  imports: [CoreModule, InfraModule, RiotModule],
})
export class WorkerModule {}
