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
    // Tests share Postgres; afterEach TRUNCATE in one file would wipe rows created
    // by another file mid-flight (and deadlock on overlapping table locks).
    fileParallelism: false,
    globalSetup: ['./integration-tests/global-setup.js'],
    // Vitest sets NODE_ENV=test by default, which means the backend's convict
    // config does NOT default `s3.endpoint` to LocalStack (that branch only
    // fires when NODE_ENV=development). Without these, the validate route's
    // downloadFileToTemp() tries to hit real AWS and hangs / 502s. Set explicitly so
    // the SDK points at LocalStack on both local dev and CI.
    env: {
      S3_ENDPOINT: 'http://localhost:4566',
      S3_FORCE_PATH_STYLE: 'true',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      AWS_REGION: 'eu-west-2',
      AWS_DEFAULT_REGION: 'eu-west-2'
    },
    coverage: {
      enabled: false,
      provider: 'v8',
      reportsDirectory: './coverage/integration',
      reporter: ['text', 'lcov', 'json-summary'],
      include: [
        'src/routes/**/*.js',
        'src/services/**/*.js',
        'src/validation/**/*.js'
      ],
      exclude: [
        '**/*.test.js',
        'src/plugins/**',
        'src/common/**',
        'src/config.js',
        'src/index.js',
        'src/server.js'
      ]
      // Thresholds intentionally omitted — measure first, then commit numbers
      // in a follow-up PR (see plan: i-want-to-extend-serene-forest.md).
    }
  }
})
