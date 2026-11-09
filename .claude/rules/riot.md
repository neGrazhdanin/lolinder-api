---
paths:
  - "src/riot/**"
  - "src/**/*.processor.ts"
  - "src/**/*.sync.ts"
  - "src/players/player-sync.service.ts"
---
# Riot API calls

- `RiotClient` is called only from worker processors. Every Riot call goes through its Redis rate
  limiter; limits come from response headers, not constants. A 429 pauses the routing value (application
  limit) or just the endpoint (method/service limit) for `Retry-After`.
- Processors wrap Riot work in `runRiotJob()` (`src/riot/riot-job.ts`): `RiotRateLimitedError` (wait > 2 s)
  moves the job to delayed instead of sleeping in a worker slot; `RiotSchemaError` is unrecoverable.
- Riot response schemas keep open enums (queue types, tiers) as strings: Riot adds event modes such as
  `JADE_RANKED_SOLO_5x5` with tier `WOOD`, and a strict enum fails the whole response. Narrow when mapping.
