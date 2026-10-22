import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    env: {
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgresql://localhost:5432/lolinder',
      REDIS_URL: 'redis://localhost:6380',
    },
  },
});
