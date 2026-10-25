import { Module } from '@nestjs/common';
import { RealtimeEmitter } from './realtime.emitter.js';

@Module({ providers: [RealtimeEmitter], exports: [RealtimeEmitter] })
export class RealtimeEmitterModule {}
