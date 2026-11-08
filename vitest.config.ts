import { defineConfig } from 'vitest/config';

// Coverage floors per layer, just under the measured numbers (`pnpm test:coverage`).
// Raise one when its layer's coverage rises; never lower one to make a change pass.
const floor = (lines: number, branches: number, functions: number, statements: number) => ({ lines, branches, functions, statements });

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/helpers/bundle-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // The standalone entry is only the bundle's wrapper; the tests run the built bundle.
      exclude: ['src/standalone/**'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: {
        'src/cli/**': floor(92, 83, 92, 91),
        'src/core/**': floor(91, 80, 87, 87),
        'src/node/**': floor(95, 87, 96, 92),
        'src/react/**': floor(89, 82, 88, 87),
        'src/serve/**': floor(94, 86, 86, 92),
        'src/vite/**': floor(91, 80, 87, 89),
      },
    },
  },
});
