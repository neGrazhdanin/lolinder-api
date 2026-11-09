---
paths:
  - "test/**"
  - "vitest.config.e2e.ts"
---
# E2E tests

- E2E starts its own Postgres and Redis via Testcontainers (Docker must be running); `pnpm infra:up` is only
  for running the app locally.
- E2E files run in parallel against one Redis, so the Riot limiter windows are shared: each file that runs a
  worker keeps its own Riot region (players: europe and asia, matches: sea) and its jobs in one file.
