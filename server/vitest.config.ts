import { defineConfig } from 'vitest/config';

// Vitest 5 no longer excludes dist/ by default, and tsc compiles the *.test.ts files there too —
// scope collection to the sources so each test runs once.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
