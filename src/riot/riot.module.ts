import { Module } from '@nestjs/common';
import { RiotClient } from './riot.client.js';

@Module({
  providers: [RiotClient],
  exports: [RiotClient],
})
export class RiotModule {}
