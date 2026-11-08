import { defineConfig } from 'vitest/config';

// Coverage floors per layer, just under the measured numbers (`pnpm test:coverage`).
// Raise one when its layer's coverage rises; never lower one to make a change pass.
const floor = (lines: number, branches: number, functions: number, statements: number) => ({ lines, branches, functions, statements });
// Coverage instruments every worker, so that run uses half the cores and leaves
// the rest for the dev servers and child processes the tests start.
const coverage = process.argv.includes('--coverage');

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The slowest tests take about 4 s in a parallel run on a laptop; leave room
    // for a loaded or slower CI runner instead of Vitest's 5 s default.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    ...(coverage && { maxWorkers: '50%' }),
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
