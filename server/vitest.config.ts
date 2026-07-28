import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // `setup.ts` gives every test file its own SQLite database before any
    // application module is imported. See the comment there.
    setupFiles: ['test/setup.ts'],
    restoreMocks: true,
  },
});
