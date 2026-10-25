import { inject } from 'vitest';

// Runs before test files import AppModule, whose ConfigModule reads process.env at import time.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
