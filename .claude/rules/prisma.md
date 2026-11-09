---
paths:
  - "prisma/**"
  - "src/infra/prisma/**"
  - "src/**/*.service.ts"
  - "src/**/*.sync.ts"
---
# Prisma and Postgres

- The client is generated into `src/generated/` (gitignored). After a schema change run
  `pnpm db:migrate --name <change>`, then `pnpm db:generate` (Prisma 7 `migrate dev` no longer regenerates
  the client), and commit the migration. A committed migration may already be applied: change the schema and
  add a new one.
- Tables are snake_case plural via `@@map` / `@map`; time columns are `TIMESTAMPTZ`.
- Riot ID lookups go through `riot_id_key` (`riotIdKey()` in `src/riot/riot-id.ts`), never `ILIKE`.
- History cursors are `(startedAt, matchId)`, matching the `match_participants` indexes. The match
  history cursor also carries the run start (`matchHistoryFrom`) it was issued under; see
  `src/matches/matches.service.ts` for why a page queues at most one older batch.
- `PrismaService` omits `Match.rawJson` and timeline `frames`/`events` by default; opt in per query with
  `omit: { rawJson: false }`.
- `prisma` on npm tags an 8.0 release candidate as `latest`; the version is pinned to 7.x in `package.json`.
