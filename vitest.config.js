import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    fileParallelism: false,
    include: [
      'src/**/*.test.js',
      'scripts/**/*.test.js',
      'bng-metric-engine/src/**/*.test.js'
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js', 'bng-metric-engine/src/**/*.js'],
      exclude: [
        ...configDefaults.exclude,
        'coverage',
        // Re-export-only facade; exercised by geopackage-internals.test.js — no executable lines to cover.
        'src/validation/geopackage/geopackage-internals.js',
        // Pure re-exports for `bng-metric-engine` package entrypoint.
        'bng-metric-engine/src/index.js',
        // Worker-thread entry point. It only ever executes inside a Worker, so
        // v8 coverage collected in the main thread cannot see it and reports 0%
        // however well it is exercised. Its behaviour is covered by
        // geos/worker-pool.test.js (which drives real workers) and by
        // integration-tests/validation-engine-modes.test.js.
        'src/validation/geopackage/geos/worker.js'
      ]
    },
    setupFiles: ['.vite/setup-files.js']
  }
})
