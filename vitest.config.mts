import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `test/` is excluded from tsconfig, so these stay out of `nest build`.
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
