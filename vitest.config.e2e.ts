import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['test/setup/containers.ts'],
    setupFiles: ['test/setup/env.ts'],
    env: { LOG_LEVEL: 'silent' },
    hookTimeout: 60_000,
  },
});
