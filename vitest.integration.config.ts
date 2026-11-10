import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/pantry-pal/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: true,
    // No reporters, outputFile or watch: test.mjs passes --reporter=json and --outputFile.
  },
});
