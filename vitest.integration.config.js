import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['integration-tests/**/*.test.js'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    forks: {
      singleFork: true
    },
    globalSetup: ['./integration-tests/global-setup.js']
  }
})
