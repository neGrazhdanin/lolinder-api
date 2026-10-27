import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { InfraModule } from './infra/infra.module.js';
import { MatchesWorkerModule } from './matches/matches-worker.module.js';
import { PlayersWorkerModule } from './players/players-worker.module.js';
import { RealtimeEmitterModule } from './realtime/realtime-emitter.module.js';
import { RiotModule } from './riot/riot.module.js';
import { StaticDataWorkerModule } from './static-data/static-data-worker.module.js';

@Module({
  imports: [
    CoreModule,
    InfraModule,
    RiotModule,
    RealtimeEmitterModule,
    StaticDataWorkerModule,
    PlayersWorkerModule,
    MatchesWorkerModule,
  ],
})
export class WorkerModule {}
