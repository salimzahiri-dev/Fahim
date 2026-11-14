import { defineConfig } from 'vitest/config';

// npm test: offline unit tests only. Database tests run with npm run test:db (vitest.db.config.ts).
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
  },
});
