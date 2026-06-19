import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    fileParallelism: false,
    // src/config.js fails fast at import if AUTH_FORWARD_SECRET is missing or
    // trivial. Set a non-trivial test fixture before any module loads so unit
    // tests importing the config can run. Never a real secret.
    env: {
      AUTH_FORWARD_SECRET: 'unit-test-auth-forward-secret'
    },
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
        'src/validation/baseline/geopackage-internals.js',
        // Pure re-exports for `bng-metric-engine` package entrypoint.
        'bng-metric-engine/src/index.js'
      ]
    },
    setupFiles: ['.vite/setup-files.js']
  }
})
