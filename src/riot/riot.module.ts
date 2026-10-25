import { Module } from '@nestjs/common';
import { RiotClient } from './riot.client.js';
import { RiotRateLimiter } from './riot-rate-limiter.js';

@Module({
  providers: [RiotClient, RiotRateLimiter],
  exports: [RiotClient],
})
export class RiotModule {}
