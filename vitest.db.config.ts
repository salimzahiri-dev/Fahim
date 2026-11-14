import { defineConfig } from 'vitest/config';

// npm run test:db: tests against the PostgreSQL of docker-compose.test.yml (npm run db:test:up).
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.{ts,tsx}'],
    globalSetup: ['tests/db/globalSetup.ts'],
    // One database for all files: run them one after the other.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
