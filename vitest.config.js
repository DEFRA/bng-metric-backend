import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    fileParallelism: false,
    include: ['src/**/*.test.js', 'scripts/**/*.test.js'],
    // The statutory calculations used to be an in-repo workspace, so Vitest
    // transformed them and their export namespace stayed spy-able. As a plain
    // dependency they would be externalised and loaded as real ESM, whose
    // namespace is frozen — breaking the `vi.spyOn(metric, ...)` tests that
    // assert how enrichment handles an unexpected engine error. Inlining
    // restores the previous conditions.
    server: {
      deps: {
        inline: ['bng-library']
      }
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      exclude: [
        ...configDefaults.exclude,
        'coverage',
        // Re-export-only facade; exercised by geopackage-internals.test.js — no executable lines to cover.
        'src/validation/geopackage/geopackage-internals.js',
        // Worker-thread entry point. It only ever executes inside a Worker, so
        // v8 coverage collected in the main thread cannot see it and reports 0%
        // however well it is exercised. Its behaviour is covered by
        // geos/worker-pool.test.js (which drives real workers) and by
        // integration-tests/validation-engine-modes.test.js.
        'src/validation/geopackage/geos/worker.js',
        // Test-only worker entry point. Like the production worker above, it
        // runs outside the process collecting V8 coverage.
        'src/validation/geopackage/geos/worker-pool.timeout-test-worker.js'
      ]
    },
    setupFiles: ['.vite/setup-files.js']
  }
})
