# Integration tests

This repo has two test suites:

- **Unit tests** (`src/**/*.test.js`) — run with `npm test`. Mock Drizzle. No external services. Run in CI without infra.
- **Integration tests** (`integration-tests/**/*.test.js`) — run with `npm run test:integration`. Boot the real Hapi server in-process, talk to a real Postgres + LocalStack S3 + cdp-uploader, and assert side-effects (rows, triggers, S3 objects) directly against those services.

The two suites are deliberately separate. `npm test` stays fast and CI-friendly; integration is opt-in and requires `docker compose up` first.

## Prerequisites

```sh
docker compose up -d
```

This brings up the full stack on the `cdp-tenant` Docker network:

| Service             | Port | Used by                           |
| ------------------- | ---- | --------------------------------- |
| `postgres`          | 5432 | every integration test            |
| `redis`             | 6379 | cdp-uploader (session state)      |
| `localstack`        | 4566 | upload + baseline tests (S3, SQS) |
| `cdp-uploader`      | 7337 | upload + baseline tests           |
| `caddy`             | 4001 | not used by tests directly        |
| `cdp-defra-id-stub` | 3200 | not used by tests directly        |

The integration suite's global setup applies Liquibase migrations automatically (`npm run db:update`) — you don't have to run them by hand.

You don't need `npm run dev` to be running. The tests boot Hapi in-process via `server.inject` and don't bind a port.

### LocalStack one-time bucket + queue setup

The compose `localstack` service ships with an init script (`compose/start-localstack.sh`) mounted into `/etc/localstack/init/ready.d/`, which creates the `baseline-files` and `cdp-uploader-quarantine` buckets, the SQS queues, and the bucket-notification wiring that fires the mock virus scan. LocalStack runs that script once on first boot and persists state under `./localstack/`.

If you ever see the upload tests fail their pre-flight check with **"LocalStack is missing the cdp-uploader buckets"**, run the script manually:

```sh
bash compose/start-localstack.sh
```

This usually means LocalStack came up before the init script could run, or its persisted state was wiped.

## Running

```sh
npm run test:integration              # tests only, no coverage
npm run test:integration:coverage     # tests + scoped coverage report
npm run test:integration:routes       # asserts every registered route was hit
npm run test:integration:full         # coverage + route assertion (used by CI + pre-push)
```

To see verbose Liquibase output during global setup:

```sh
DEBUG_INTEGRATION=1 npm run test:integration
```

To target a single file:

```sh
npm run test:integration -- integration-tests/audit-log.test.js
```

## Coverage and the route gate

Integration tests are gated by **two** independent checks. The intent is to prove every endpoint is exercised end-to-end without chasing pure line %.

**Layer 1 — scoped line coverage.** `npm run test:integration:coverage` writes `coverage/integration/` (text + lcov + json-summary). The vitest config (`vitest.integration.config.js`) limits coverage to:

- `src/routes/**`
- `src/services/**`
- `src/validation/**`

and excludes framework wiring (`src/plugins/`, `src/common/`, `src/config.js`, `src/server.js`, `src/index.js`). Thresholds are intentionally **not yet committed** — they will be set in a follow-up PR after measuring on `main`.

**Layer 2 — route coverage.** `helpers/server.js` registers a Hapi `onPreResponse` extension on every test server (the `routeRecorder` plugin). For every request, it records `${method} ${request.route.path}` (the route _template_, e.g. `GET /projects/{id}`, not the concrete URL `GET /projects/abc-123`) and writes the result synchronously to `coverage/route-hits.json` whenever it sees a previously-unseen entry.

`global-setup.js` resets that file to `[]` once at the start of every run, so stale hits from prior runs don't leak in.

`scripts/assert-route-coverage.mjs` then boots the server (no port — it just reads `server.table()`) and asserts three things:

1. Every route registered by `src/plugins/router.js` is listed in `integration-tests/route-manifest.json`.
2. Every entry in the manifest is actually a registered route (catches typos and stale entries).
3. Every entry in the manifest was hit by at least one integration test.

Failing any of the three exits non-zero, which fails `test:integration:full`, which fails the pre-push hook and the CI check.

### Why this design

A single line-% threshold is gameable: trivial wiring code drags the metric down or it gets set so low it certifies nothing. Splitting into (a) scoped line coverage on the parts that actually benefit from end-to-end exercise and (b) a manifest assertion that proves every registered route was hit is the smallest implementation that catches both "someone added an endpoint but no test" and "someone wrote a happy-path-only test for one branch and walked away".

### Why hits are written inline instead of at end-of-run

Vitest's `globalTeardown` runs in the main process, but tests run in a worker fork — different module instances, separate `Set`s. A teardown-time flush would see an empty set. Vitest workers also default to `isolate: true`, so each test file gets a fresh module graph (a worker-scoped flush would see only the last file's hits). Writing synchronously inside the recorder, with the recorder reading + merging the on-disk file before each write, sidesteps both.

## File upload tests (LocalStack + cdp-uploader)

The upload (`POST /upload/initiate`, `GET /upload/{uploadId}/status`) and validate (`POST /baseline/validate/{uploadId}`) tests run the **real** path: backend → cdp-uploader (HTTP) → LocalStack S3. There is no nock/msw stub of cdp-uploader. Helpers under `integration-tests/helpers/upload-fixtures.js` walk the flow:

- `uploadViaCdpUploader({ uploadUrl, filePath })` — POSTs the file as multipart to the URL returned by `/upload/initiate`.
- `waitForUploadStatus(server, uploadId)` — polls `/upload/{uploadId}/status` until cdp-uploader's mock virus scan completes (~2s).
- `assertS3ObjectExists(bucket, key)` — HEADs the LocalStack S3 object via `@aws-sdk/client-s3`.

Both upload-using files (`upload.test.js`, `baseline.test.js`) run two `beforeAll` pre-flight checks:

- `assertCdpUploaderReachable()` — fast `GET /health` against cdp-uploader; fails with a clear "run docker compose up -d" message if it can't connect.
- `assertLocalStackPipelineReady()` — HEAD on `baseline-files` + `cdp-uploader-quarantine`; fails with "run bash compose/start-localstack.sh" if the buckets are missing.

These mean an unhealthy local stack produces one explicit error per file rather than ~30s of opaque test timeouts.

GeoPackage fixtures live in `integration-tests/fixtures/`. They are committed copies of the canonical examples in the harness repo's `example-files/` so the backend test suite is self-contained.

## How it works

```
  vitest run --config vitest.integration.config.js
       │
       ▼
  globalSetup (integration-tests/global-setup.js)
       │  1. wipe coverage/route-hits.json (Layer 2 reset)
       │  2. probe Postgres on DB_HOST:DB_PORT
       │  3. npm run db:update  (Liquibase via Docker, idempotent)
       ▼
  beforeAll (helpers/server.js: startServer)
       │  - createServer() then register the routeRecorder plugin
       │  - server.initialize() (no port binding)
       │  - upload + baseline tests also assertCdpUploaderReachable()
       │    and assertLocalStackPipelineReady() here
       ▼
  test body
       │
       │  server.inject({method, url}) ─► route ─► drizzle / wreck / aws-sdk
       │                                              │
       │                                              ▼
       │                            Postgres / cdp-uploader / LocalStack
       │
       │  routeRecorder onPreResponse fires:
       │    if route is new, write coverage/route-hits.json
       ▼
  afterEach: truncateTestData(dbClient)  (DB-using files only)
  afterAll:  server.stop()
```

In-process means no port collisions, no readiness flakes, no `npm run dev` requirement. Coverage of the route → handler → service → external-service path is identical to a real HTTP call.

## File layout

```
integration-tests/
├── audit-log.test.js                ← cross-route flow (POST + PATCH + audit_log trigger)
├── baseline.test.js                 ← POST /baseline/validate/{uploadId} (real GeoPackages)
├── db-info.test.js                  ← GET /db-info smoke
├── health.test.js                   ← GET /health smoke
├── projects.test.js                 ← all four /projects routes
├── upload.test.js                   ← POST /upload/initiate + GET /upload/{id}/status
├── users.test.js                    ← GET /users/{userId}/projects (sort/order)
├── route-manifest.json              ← every endpoint that should exist
├── global-setup.js                  ← DB probe + Liquibase + reset route-hits.json
├── fixtures/
│   ├── baseline-complete.gpkg       ← valid 1.2MB GeoPackage
│   ├── baseline-no-rlb.gpkg         ← valid GeoPackage missing red line boundary layer
│   └── not-a-valid-geopackage.gpkg  ← 26-byte junk
└── helpers/
    ├── server.js                    ← startServer + stopServer (registers routeRecorder)
    ├── db.js                        ← raw pg.Client factory for assertions
    ├── db-cleanup.js                ← truncateTestData for between-test isolation
    ├── route-recorder.js            ← Hapi plugin → coverage/route-hits.json
    └── upload-fixtures.js           ← uploadViaCdpUploader, waitForUploadStatus,
                                       assertS3ObjectExists, pre-flight checks

scripts/assert-route-coverage.mjs    ← Layer 2 gate (manifest ↔ registered ↔ hits)
```

## Adding a new endpoint

When you add a route to `src/plugins/router.js`, **three things** must change in the same PR or the route gate will block the push:

1. The route definition itself in `src/routes/...` and registered in `src/plugins/router.js`.
2. A line in `integration-tests/route-manifest.json` of the form `"METHOD /path"` (use the route template, with `{params}` not concrete values).
3. At least one integration test that hits it via `server.inject`.

The recorder picks up the hit automatically — there's no extra ceremony beyond writing the test.

## Adding a new scenario (existing endpoint)

1. Add a new file under `integration-tests/` named after the behaviour you're verifying (e.g. `baseline-upload.test.js`).
2. Use the helpers from `integration-tests/helpers/` — don't import anything from `src/**/*.test.js` (those mock Drizzle and aren't suitable here).
3. Generate a unique key per run (e.g. `userId = \`it-${randomUUID()}\``) so a CI failure mid-test doesn't poison the next run, OR call `truncateTestData(dbClient)`from`db-cleanup.js`in`afterEach` for full per-test isolation.
4. Use `server.inject({ method, url, payload })` to make HTTP calls. The Hapi response object is `{ statusCode, result, payload, ... }`; `result` is the parsed body.
5. Use the raw `pg.Client` from `helpers/db.js` for assertions and cleanup. Don't reuse the request-scoped Drizzle instance — it's tied to the Hapi pool's lifecycle.
6. If the test uploads files, call `assertCdpUploaderReachable()` and `assertLocalStackPipelineReady()` from `helpers/upload-fixtures.js` in `beforeAll` — they give you a clear failure message if the local stack isn't ready.

## Environment variables

Most env vars are pre-set by `vitest.integration.config.js`'s `env` block so they take effect at module-load time (convict caches env vars at import). You don't need to export them yourself.

| Var                                           | Set by vitest config? | Default                                   |
| --------------------------------------------- | --------------------- | ----------------------------------------- |
| `DB_HOST`                                     | no                    | `localhost`                               |
| `DB_PORT`                                     | no                    | `5432`                                    |
| `DB_USER`                                     | no                    | `dev`                                     |
| `DB_LOCAL_PASSWORD`                           | no                    | `dev`                                     |
| `DB_DATABASE`                                 | no                    | `bng_metric_backend`                      |
| `S3_ENDPOINT`                                 | **yes**               | `http://localhost:4566`                   |
| `S3_FORCE_PATH_STYLE`                         | **yes**               | `true`                                    |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | **yes**               | `test` / `test`                           |
| `AWS_REGION` / `AWS_DEFAULT_REGION`           | **yes**               | `eu-west-2`                               |
| `CDP_UPLOADER_URL`                            | no                    | `http://localhost:7337` (service default) |
| `FIXTURES_DIR`                                | no                    | `integration-tests/fixtures`              |
| `SKIP_MIGRATIONS`                             | no (set by CI only)   | unset                                     |

Override the DB ones if you're pointing at a non-default Postgres. The S3/AWS ones are forced by vitest because Vitest sets `NODE_ENV=test` by default, which suppresses the backend's `isDevelopment` LocalStack defaults — without these the AWS SDK would try to talk to real AWS and hang.

## Why a separate vitest config?

`vitest.config.js` (the unit config) loads `.vite/setup-files.js`, which globally mocks `fetch` via `vitest-fetch-mock`. Integration tests must talk to real services, so they use a dedicated config (`vitest.integration.config.js`) that omits the setup file and adds:

- `globalSetup` to probe Postgres, apply migrations, and reset the route-hits file once before the suite.
- `pool: 'forks'` with `singleFork: true` and `fileParallelism: false`. Both are required: `singleFork` keeps everything in one process, `fileParallelism: false` makes files run sequentially within that process. Without the second flag, files run concurrently and trample each other (concurrent `TRUNCATE` deadlocks on overlapping table locks; an `afterEach` truncate in one file wipes data created by another file's in-flight test).
- `env` block forcing `S3_ENDPOINT`, `AWS_*`, and friends so the backend's S3 client points at LocalStack regardless of `NODE_ENV`.
- `coverage` block scoped to `src/routes/**`, `src/services/**`, `src/validation/**`.
- Longer timeouts (the first Liquibase run pulls a Docker image; uploads through cdp-uploader take ~3s).

## CI

The integration suite runs on every PR via the `backend-integration-tests` job in `.github/workflows/check-pull-request.yml`. That job:

1. Spins up Postgres, Redis, and LocalStack as service containers.
2. Downloads Liquibase locally (CI runners don't share the local `cdp-tenant` Docker network the dev script uses).
3. Applies the changelog directly against the Postgres service.
4. Seeds LocalStack via `compose/start-localstack.sh` (creates buckets, SQS queues, bucket notifications).
5. Starts cdp-uploader as a `docker run` step (with `--network host` so it reaches LocalStack and Redis on the runner's localhost). It runs as a step rather than a service container because it depends on the bucket-seed step having completed first.
6. Runs `npm run test:integration:full` — coverage plus the route gate.
7. Uploads `coverage/` as a build artifact.

`SKIP_MIGRATIONS=1` tells `global-setup.js` to skip its own `npm run db:update` step (which would otherwise try to start a Liquibase Docker container on the `cdp-tenant` network — fine locally, doesn't apply in CI). When `SKIP_MIGRATIONS` is set, the suite still runs the Postgres readiness probe.

### Branch protection

For the gate to actually block merges, the **`Backend Integration Tests`** check must be marked **Required** under the repo's branch protection rules (Settings → Branches → branch protection for `main`). Without that, a failing job is informational only. This is configured outside the repo and is not enforced by anything committed here.

### Pre-push hook

A husky `pre-push` hook runs `npm run test:integration:full` before each push. It will fail the push if any test, coverage threshold, or route gate fails. Pre-commit deliberately runs only the lighter chain (lint + unit) so day-to-day commits stay fast — see `.husky/pre-commit` and `.husky/pre-push`.

The harness-level `scripts/test.mjs` (in `bng-metric-harness`) invokes `npm test` per sibling and intentionally does **not** pick up the backend integration suite. Wiring those into the harness is a separate change if we ever want a single cross-repo entrypoint.

## Troubleshooting

- **"Postgres not reachable"** — `docker compose up -d` first. Check `docker compose ps` for the postgres service status.
- **"Liquibase migrations failed"** — confirm the `cdp-tenant` Docker network exists (`docker network ls | grep cdp-tenant`); compose creates it. Re-run `npm run db:update` standalone to see Liquibase's output.
- **"cdp-uploader not reachable at http://localhost:7337"** — `docker compose up -d cdp-uploader` (it may not have started if you ran an older `docker compose up` that predates its addition to `compose.yml`).
- **"LocalStack is missing the cdp-uploader buckets"** — run `bash compose/start-localstack.sh`. The init script creates buckets, SQS queues, and bucket-notification wiring; LocalStack only runs it once on fresh state, so a stale `./localstack/` directory can leave the wiring missing.
- **Upload tests stuck at status `initiated`** — symptom of the bucket-notification wiring being missing; same fix as above.
- **`/baseline/validate` returns 502 or hangs** — the backend's S3 client isn't pointed at LocalStack. The vitest config's `env` block should handle this; if you've overridden `NODE_ENV` or unset `S3_ENDPOINT`, restore them.
- **"Route hits file not found"** — only happens if you run `test:integration:routes` without first running `test:integration:coverage`. Use `test:integration:full` to run both in order.
- **Adding a route fails the push** — you also need to add `"METHOD /path"` to `integration-tests/route-manifest.json` and write at least one test that hits it. See [Adding a new endpoint](#adding-a-new-endpoint).
- **Test hangs** — the postgres plugin verifies connectivity at register time and will hang if credentials are wrong. Check the env vars above against what `compose.yml` sets.
- **Stale data** — most tests now use `truncateTestData` in `afterEach`. If a previous run failed before that ran and left rows behind, the next run's first `afterEach` will clean it. To clean manually: `psql -h localhost -U dev bng_metric_backend -c "TRUNCATE bng.audit_log, bng.projects RESTART IDENTITY CASCADE"`.
