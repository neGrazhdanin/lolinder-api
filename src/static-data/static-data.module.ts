import { Module } from '@nestjs/common';
import { StaticDataController } from './static-data.controller.js';
import { StaticDataService } from './static-data.service.js';

@Module({
  controllers: [StaticDataController],
  providers: [StaticDataService],
  exports: [StaticDataService],
})
export class StaticDataModule {}
