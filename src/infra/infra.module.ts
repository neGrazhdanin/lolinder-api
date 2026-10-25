import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [PrismaModule, RedisModule, QueueModule],
})
export class InfraModule {}
