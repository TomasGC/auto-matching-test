import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/testing/globalSetup.ts'],
    // Never the development database: the tests drop and recreate this one.
    env: { PGDATABASE: 'matching_test' },
  },
});
