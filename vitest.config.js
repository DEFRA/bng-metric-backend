import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    fileParallelism: false,
    include: ['src/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      exclude: [
        ...configDefaults.exclude,
        'coverage',
        // Re-export-only facade; exercised by geopackage-internals.test.js — no executable lines to cover.
        'src/validation/baseline/geopackage-internals.js'
      ]
    },
    setupFiles: ['.vite/setup-files.js']
  }
})
