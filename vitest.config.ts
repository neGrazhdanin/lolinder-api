import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    env: { LOG_LEVEL: 'silent' },
  },
});
