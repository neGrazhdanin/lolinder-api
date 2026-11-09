# lolinder-api

NestJS 12 (ESM, Fastify) backend for lolinder: LoL stats from the Riot API plus a social layer.
Product, Riot API limits, data model and roadmap: `../lolinder-docs.md` (local file outside the repo).
Tasks live in GitHub Issues of this repo; epics for later stages are #19–#23.

## Verify before handing over

`pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` (e2e needs Docker running).
One unit file: `pnpm test src/riot/riot-id.spec.ts`; one e2e file: `pnpm test:e2e test/matches.e2e-spec.ts`.
Prisma, Riot and e2e rules load from `.claude/rules/` when you work in those files.

## Architecture invariants

- The API never calls Riot. Handlers read Postgres/Redis and enqueue a BullMQ job; the worker
  (`src/worker.ts`) calls Riot, saves, and emits a WebSocket event. The one request that waits is a search
  for an unknown Riot ID: it waits for its job up to 5 s, then answers 202 with `Retry-After`. Data fetched
  on first view (match timelines) answers 202 with `Retry-After` at once and the client repeats the request.
- `RiotClient` is called only from worker processors, through its Redis rate limiter.
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

## Gotchas

- Fastify's middleware layer strips `req.url` to `/`; use `req.originalUrl` (see `src/core/core.module.ts`).
- Biome `useImportType` is off on purpose: `import type` for an injected class breaks Nest DI metadata.
  Keep value imports for anything injected through a constructor.
- Fastify listens on `localhost` by default; containers need `HOST=0.0.0.0`.
- Express middleware does not work here; use `@fastify/*` plugins.
- Gateways need `@UseFilters(HttpErrorFilter)` and `@SkipThrottle()`: `APP_FILTER` does not reach socket
  handlers, while the global `ThrottlerGuard` does and puts every socket into one shared bucket.
- Shared clients (Redis, Prisma) close in `onApplicationShutdown`; `WorkerShutdown` closes BullMQ workers
  earlier so active jobs finish with live connections. Do not close shared clients in `onModuleDestroy`.

## Workflow

- Branch per issue: `<type>/<issue>-<slug>`. PR description has `Closes #N`.
- Commits: Conventional Commits in English, subject ≤ 72 chars, a body only when the why is not obvious
  from the diff. No `Co-Authored-By` or "Generated with" trailers.
- Commit or push only when asked; `main` is protected by a local hook. `/commit` and `/pr` skills follow these
  rules.
- `.env` holds the Riot API key and is deny-listed for reading; `.env.example` lists the variables.
- When scope changes, update the issue checklist.
