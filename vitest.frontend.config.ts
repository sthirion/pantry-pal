import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/pantry-pal.Frontend/**/*.test.ts',
      'src/pantry-pal.Frontend/**/*.test.tsx',
      'src/pantry-pal.Frontend/**/*.spec.ts',
      'src/pantry-pal.Frontend/**/*.spec.tsx',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'jsdom',
    setupFiles: ['src/pantry-pal.Frontend/src/test/setup.ts'],
    passWithNoTests: true,
    // No reporters, outputFile or watch: test.mjs passes --reporter=json and --outputFile.
  },
});
