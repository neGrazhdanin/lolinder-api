import { inject } from 'vitest';

// Runs before test files import AppModule, whose ConfigModule reads process.env at import time.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
// Riot itself is always mocked with nock in e2e; RiotClient only needs a key-shaped value.
process.env.RIOT_API_KEY = 'RGAPI-e2e'; // secrets-scan:allow
