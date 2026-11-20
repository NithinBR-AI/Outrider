// Test configuration. Unit tests live next to the code in src/**/__tests__/;
// recorded fixtures and integration tests live under tests/ (spec §4.4, §19).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts only re-exports handlers. The UI (frontend/*.jsx) is checked on the site.
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
      reporter: ['text'],
      // Spec §19.1: domain logic targets 100% branch coverage. `npm run coverage` fails below it.
      thresholds: {
        'src/domain/**/*.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
