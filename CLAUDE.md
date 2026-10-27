# lolinder-api

NestJS 12 (ESM, Fastify) backend for lolinder: LoL stats from the Riot API plus a social layer.
Product, Riot API limits, data model and roadmap: `../lolinder-docs.md` (local file outside the repo).
Tasks live in GitHub Issues of this repo; epics for later stages are #19–#23.

## Verify before handing over

`pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`. E2E starts its own Postgres and Redis via
Testcontainers (Docker must be running); `pnpm infra:up` is only for running the app locally.
E2E files run in parallel against one Redis, so the Riot limiter windows are shared: each file that runs a
worker keeps its own Riot region (players: europe and asia, matches: sea) and its jobs in one file.
The Prisma client is generated into `src/generated/` (gitignored). After a schema change run
`pnpm db:migrate --name <change>`, then `pnpm db:generate` (Prisma 7 `migrate dev` no longer regenerates
the client), and commit the migration; never edit an applied migration.

## Architecture invariants

- The API never calls Riot. Handlers read Postgres/Redis and enqueue a BullMQ job; the worker
  (`src/worker.ts`) calls Riot, saves, and emits a WebSocket event. The one request that waits is a search
  for an unknown Riot ID: it waits for its job up to 5 s, then answers 202 with `Retry-After`.
- `RiotClient` is called only from worker processors. Every Riot call goes through its Redis rate
  limiter; limits come from response headers, not constants. A 429 pauses the routing value (application
  limit) or just the endpoint (method/service limit) for `Retry-After`.
- Processors wrap Riot work in `runRiotJob()` (`src/riot/riot-job.ts`): `RiotRateLimitedError` (wait > 2 s)
  moves the job to delayed instead of sleeping in a worker slot; `RiotSchemaError` is unrecoverable.
- Finished matches are immutable: stored forever, never re-fetched.
- `RiotAccount` keeps `gameName`/`tagLine` next to `puuid`: PUUIDs are encrypted per API key and
  change when we move to a Production Key.
- Game objects (champions, items, runes) are stored as Data Dragon IDs only; the client resolves
  names and icons per locale.
- API and worker share modules; BullMQ processors are registered only in `WorkerModule`.

## API contract

- Success responses return the resource itself, no `{ data }` wrapper.
- Errors are `{ code: ErrorCode, details? }` via `AppException` (`src/common/errors/`). Add new codes
  to `ErrorCode`; the client translates by code, so responses carry no user-facing text. `details` is
  for debugging (validation issues carry zod's English messages) and is never shown to users.
- Validation: zod schemas on `@Body({ schema })` / `@Query` / `@Param` through the global
  `StandardSchemaValidationPipe`. No class-validator.
- Dates ISO 8601 UTC; Riot IDs (`puuid`, `matchId`) are strings; Data Dragon IDs are numbers; JSON keys camelCase.
- Lists are cursor-paginated: `{ items, nextCursor }`.
- Realtime is socket.io on the API process (`src/realtime/`); OpenAPI does not describe it, so event
  names and payloads live in `realtime.events.ts`. Clients emit `player:subscribe` / `player:unsubscribe`
  with `{ puuid }` (ack `true`); the worker sends `player:updated` (profile) and `player:matches-updated`
  (match history) to that room through `RealtimeEmitter`, also when a job gives up. Socket errors
  arrive as an `exception` event with the same `{ code, details? }`.
- Postgres: snake_case plural tables via `@@map` / `@map`, `TIMESTAMPTZ` for time.
- Riot ID lookups go through `riot_id_key` (`riotIdKey()` in `src/riot/riot-id.ts`), never `ILIKE`.
- History cursors are `(startedAt, matchId)`, matching the `match_participants` indexes. The match
  history cursor also carries the run start (`matchHistoryFrom`) it was issued under; see
  `src/matches/matches.service.ts` for why a page queues at most one older batch.

## Gotchas

- Fastify's middleware layer strips `req.url` to `/`; use `req.originalUrl` (see `src/core/core.module.ts`).
- Biome `useImportType` is off on purpose: `import type` for an injected class breaks Nest DI metadata.
  Keep value imports for anything injected through a constructor.
- Fastify listens on `localhost` by default; containers need `HOST=0.0.0.0`.
- Express middleware does not work here; use `@fastify/*` plugins.
- Riot response schemas keep open enums (queue types, tiers) as strings: Riot adds event modes such as
  `JADE_RANKED_SOLO_5x5` with tier `WOOD`, and a strict enum fails the whole response. Narrow when mapping.
- Gateways need `@UseFilters(HttpErrorFilter)` and `@SkipThrottle()`: `APP_FILTER` does not reach socket
  handlers, while the global `ThrottlerGuard` does and puts every socket into one shared bucket.
- `prisma` on npm tags an 8.0 release candidate as `latest`; the version is pinned to 7.x in `package.json`.
- `PrismaService` omits `Match.rawJson` and timeline `frames`/`events` by default; opt in per query with
  `omit: { rawJson: false }`.
- Shared clients (Redis, Prisma) close in `onApplicationShutdown`; `WorkerShutdown` closes BullMQ workers
  earlier so active jobs finish with live connections. Do not close shared clients in `onModuleDestroy`.

## Workflow

- Branch per issue: `<type>/<issue>-<slug>`. PR description has `Closes #N`.
- Commits: Conventional Commits in English, subject ≤ 72 chars, a body only when the why is not obvious
  from the diff. No `Co-Authored-By` or "Generated with" trailers.
- Commit or push only when asked; `main` is protected by a local hook.
- When scope changes, update the issue checklist.
