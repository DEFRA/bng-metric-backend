# Integration tests

This repo has two test suites:

- **Unit tests** (`src/**/*.test.js`) — run with `npm test`. Mock Drizzle. No external services. Run in CI without infra.
- **Integration tests** (`integration-tests/**/*.test.js`) — run with `npm run test:integration`. Boot the real Hapi server in-process, talk to a real Postgres, and assert side-effects (rows, triggers) directly against the database.

The two suites are deliberately separate. `npm test` stays fast and CI-friendly; integration is opt-in and requires `docker compose up` first.

## Prerequisites

```sh
docker compose up -d
```

This brings up Postgres, Redis, LocalStack, and the cdp-defra-id-stub on the `cdp-tenant` Docker network. The integration suite's global setup will then apply Liquibase migrations automatically (`npm run db:update`) — you don't have to run them by hand.

You don't need `npm run dev` to be running. The tests boot Hapi in-process via `server.inject` and don't bind a port.

## Running

```sh
npm run test:integration
```

To see verbose Liquibase output during global setup:

```sh
DEBUG_INTEGRATION=1 npm run test:integration
```

To target a single file:

```sh
npm run test:integration -- integration-tests/audit-log.test.js
```

## How it works - working example only

```
  vitest run --config vitest.integration.config.js
       │
       ▼
  globalSetup (integration-tests/global-setup.js)
       │  1. probe Postgres on DB_HOST:DB_PORT
       │  2. npm run db:update  (Liquibase via Docker, idempotent)
       ▼
  beforeAll: createServer() + server.initialize()
                                        │
       inject ─► route ─► drizzle ─► pg pool ─► Postgres
                                                   │
                                                   ▼
                                         AFTER INSERT/UPDATE trigger
                                         writes bng.audit_log row
       │
  afterAll: server.stop()  + raw pg.Client cleanup of test rows
```

In-process means no port collisions, no readiness flakes, no `npm run dev` requirement. Coverage of the route → handler → Drizzle → Postgres → trigger path is identical to a real HTTP call.

## File layout

```
integration-tests/
├── audit-log.test.js              ← scenario (example)
├── global-setup.js                ← DB probe + migrations (runs once)
└── helpers/
    ├── server.js                  ← createServer + initialize/stop
    └── db.js                      ← pg.Client factory for assertions
```

## Adding a new scenario

1. Add a new file under `integration-tests/` named after the behaviour you're verifying (e.g. `baseline-upload.test.js`).
2. Use the helpers from `integration-tests/helpers/` — don't import anything from `src/**/*.test.js` (those mock Drizzle and aren't suitable here).
3. Generate a unique key per run (e.g. `userId = \`it-${randomUUID()}\``) so a CI failure mid-test doesn't poison the next run.
4. Use `server.inject({ method, url, payload })` to make HTTP calls. The Hapi response object is `{ statusCode, result, payload, ... }`; `result` is the parsed body.
5. Use the raw `pg.Client` from `helpers/db.js` for assertions and cleanup. Don't reuse the request-scoped Drizzle instance — it's tied to the Hapi pool's lifecycle.

## Environment variables

The test suite reads the same DB env vars as the runtime, with the same defaults (see `src/config.js`):

| Var                 | Default              |
| ------------------- | -------------------- |
| `DB_HOST`           | `localhost`          |
| `DB_PORT`           | `5432`               |
| `DB_USER`           | `dev`                |
| `DB_LOCAL_PASSWORD` | `dev`                |
| `DB_DATABASE`       | `bng_metric_backend` |

Override these if you're pointing at a non-default Postgres.

## Why a separate vitest config?

`vitest.config.js` (the unit config) loads `.vite/setup-files.js`, which globally mocks `fetch` via `vitest-fetch-mock`. Integration tests must talk to real services, so they use a dedicated config (`vitest.integration.config.js`) that omits the setup file and adds:

- `globalSetup` to probe Postgres and apply migrations once before the suite.
- `pool: 'forks'` with `singleFork: true` so tests share a single process — important when more scenarios are added, to avoid row-collision flake.
- Longer timeouts (the first Liquibase run pulls a Docker image).

## CI

The integration suite runs on every PR via the `backend-integration-tests` job in `.github/workflows/check-pull-request.yml`. That job:

1. Spins up a Postgres service container (`postgis/postgis:16-3.5`) on `localhost:5432`.
2. Downloads Liquibase locally (CI runners don't share the local `cdp-tenant` Docker network the dev script uses).
3. Applies the changelog directly against the service container.
4. Runs `SKIP_MIGRATIONS=1 npm run test:integration`.

`SKIP_MIGRATIONS=1` tells `global-setup.js` to skip its own `npm run db:update` step (which would otherwise try to start a Liquibase Docker container on the `cdp-tenant` network — fine locally, doesn't apply in CI). When `SKIP_MIGRATIONS` is set, the suite still runs the Postgres readiness probe.

The harness-level `scripts/test.mjs` (in `bng-metric-harness`) invokes `npm test` per sibling and intentionally does **not** pick up the backend integration suite. Wiring those into the harness is a separate change if we ever want a single cross-repo entrypoint.

## Troubleshooting

- **"Postgres not reachable"** — `docker compose up -d` first. Check `docker compose ps` for the postgres service status.
- **"Liquibase migrations failed"** — confirm the `cdp-tenant` Docker network exists (`docker network ls | grep cdp-tenant`); compose creates it. Re-run `npm run db:update` standalone to see Liquibase's output.
- **Test hangs** — the postgres plugin verifies connectivity at register time and will hang if credentials are wrong. Check the env vars above against what `compose.yml` sets.
- **Stale data** — if a previous run failed mid-test and left rows behind, they'll be keyed by the old run's `userId`. The next run uses a fresh UUID so it won't conflict, but you can clean manually with `psql -h localhost -U dev bng_metric_backend -c "DELETE FROM bng.audit_log WHERE user_id LIKE 'it-%'; DELETE FROM bng.projects WHERE user_id LIKE 'it-%';"`.
