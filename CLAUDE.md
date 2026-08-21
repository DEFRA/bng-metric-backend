# bng-metric-backend

Hapi API on port 3001. Postgres (via Liquibase migrations) is the system of record; Drizzle ORM provides typed access; Joi validates JSONB documents before they are persisted (see [Persisting project data](#persisting-project-data)).

## Database migrations (Liquibase)

All schema changes go through Liquibase changesets in `changelog/`. **Never edit an applied changeset** — Liquibase tracks them by checksum and will reject modifications. Add a new `db.changelog-<version>.xml` file and include it in `changelog/db.changelog.xml` after the existing entries.

Two flavours of change:

- **Postgres column / table / index / function** — write a new changeset (`<addColumn>`, `<createTable>`, `<sql>` for PostGIS or trigger functions, etc.). Always set `schemaName="bng"`. Use one logical change per `<changeSet>`, give it a `<comment>`, and include a `<rollback>` for raw `<sql>`.
- **JSONB field inside an existing column** — no DDL. Update the `runOnChange="true"` test data in `changelog/db.changelog-1.0-testdata.xml` so schema reflection can regenerate Joi schemas.

### Workflow

```sh
# 1. Write the changeset under changelog/ and include it in db.changelog.xml
# 2. Apply locally (postgres must be up: docker compose up postgres -d)
npm run db:update
npm run db:validate

# 3. Reflect the live schema → JSON, then update Drizzle (src/db/schema/) and
#    Joi (src/validation/) by hand to match
node scripts/reflect-schema.js

# 3b. If you changed src/validation/project.js, regenerate the data dictionary
#     (a CI step fails the PR if data-dictionary/data-dictionary.* drifts from the schema)
npm run data-dictionary

# 4. Tests
npm test
```

After local verification, push and open a PR — the `backend-integration-tests` job in **Check Pull Request** re-runs migrations from scratch against a clean Postgres service container before running the integration suite, so a broken changeset surfaces there. Once merged, run **Publish DB Schema** from `main` and apply the published version through the CDP Portal (dev → test → ext-test → prod).

For the full end-to-end procedure, including changeset examples, JSONB handling, and the CDP Portal promotion steps, see [`docs/DATABASE_CHANGES.md`](docs/DATABASE_CHANGES.md). The reflection step is documented in [`docs/SCHEMA_REFLECTION.md`](docs/SCHEMA_REFLECTION.md).

## Persisting project data

All writes to the `bng.projects.project` JSONB column go through one validated
choke point: `src/db/persist-project.js`. Its actor-aware helpers cover project
creation, name and details changes, baseline/post-intervention replacement, and
individual feature changes. Update helpers require the verified Defra ID token
`sub` as `actorId` and stamp `projects.last_modified_by`; creation stamps the
verified `userId`. Each helper validates only the fragment it writes against
the matching Joi schema, and partial updates use `jsonb_set`. An ESLint
`no-restricted-syntax` rule bans direct `.insert(projects)` /
`.update(projects)` outside that module, so a new write **must** use a helper
and supply its actor — `npm run lint` rejects bypasses. See
[`docs/PERSISTENCE.md`](docs/PERSISTENCE.md).

The persisted shape is documented in a generated data dictionary — `data-dictionary/data-dictionary.{md,json}` via `npm run data-dictionary`, sourced from the Drizzle tables, the per-table `TABLE_DESCRIPTIONS` map in `scripts/gen-data-dictionary.js`, and the Joi `.description()` annotations in `src/validation/project.js`. A CI step fails the PR if the committed docs drift from the schema, and coverage tests assert the code only persists schema-declared fields. On merge to `main` the **Publish Data Dictionary** workflow mirrors the Markdown to Confluence (only when it changed). See [`docs/DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md).

## Code organisation

The backend serves two upload flows, **baseline** and **post-intervention**, and
they share the GeoPackage validate pipeline, the save/persist orchestration and
the engine adapters. Code is organised three ways — baseline, post-intervention,
and shared — with shared code given a domain-precise name (`geopackage`,
`upload`, `reference`, `engine-helpers`) rather than a generic `shared`.

GeoPackage validation and reference data live under
`src/validation/geopackage/` and `src/validation/reference/`; shared
save/persist lives under `src/services/upload/`; enrichment lives under
`src/utilities/enrichment/{shared,baseline,post-intervention}/`; validate
routes share `src/routes/validate-geopackage-route.js` with flow-specific
route modules; Drizzle feature tables are split by family under
`src/db/schema/`. ESLint path guardrails in `eslint.config.js` forbid
enrichment and status cross-imports (see Guardrails in
[`docs/CODE_STRUCTURE.md`](docs/CODE_STRUCTURE.md)). Check a file's
importers before assuming a `baseline/` path is baseline-only, and put
anything used by both flows in a shared module rather than under a
flow-specific folder.

Read [`docs/CODE_STRUCTURE.md`](docs/CODE_STRUCTURE.md) before adding a file or
moving one — it has the target layout, a "where does this go?" decision list,
and remaining traps. The sequenced migration that landed this layout is in
[`docs/CODE_STRUCTURE_MIGRATION.md`](docs/CODE_STRUCTURE_MIGRATION.md).

## Asynchronous GeoPackage validation

Behind `ASYNC_VALIDATION_ENABLED` (off by default). The frontend flag of the
same name must move in lock-step: the async routes are only registered when the
flag is on, so an environment with it off cannot be handed work its dispatcher
is not running to pick up.

`POST /baseline/validate-async/{uploadId}` records a row in
`bng.validation_jobs` and returns **202** with a `statusUrl`. There is no
hold-open window — always 202, one response shape, one client path.
`GET /validation-jobs/{jobId}` is polled until `done`, and carries the _same_
payload the synchronous route would have returned, so downstream code does not
care which path produced it. Note a rejected file is a **succeeded** job whose
`result.valid` is false: the job succeeded in establishing the file is invalid.
`failed` means the job never reached an answer and the upload should be retried.

### Why a worker thread, and not just a queue

The parse is pure synchronous CPU — `read-feature-tables.js` contains no
`await` at all — so on the main thread it blocks _every_ unrelated request for
its whole duration. Measured: ~270ms for a 5.6MB file, scaling with size.

Enqueuing alone does not fix that. A dispatcher running in the same process
runs the same synchronous code on the same loop; the uploader gets a fast 202
while everyone else still freezes. Only `runParseInWorker` moves it
(270ms → 75ms of worst-case loop lag in the same measurement). **If you ever
inline the parse back into the dispatcher "for simplicity", the story is
undone.**

Only the parse is on the thread. The rest of the pipeline needs database
access, which would mean a second pool per thread and writes outside the
`persist-project.js` chokepoint — and those stages are await-heavy, so they
yield anyway. The residual lag is the structured clone of the parsed layers
coming back.

### Shape of it

- `services/validation-jobs/job-store.js` — claim is `SELECT ... FOR UPDATE
SKIP LOCKED`, so instances share the table with no distributed lock. Also
  holds the reaper (jobs whose worker died), the bury (jobs out of attempts,
  which the claim query skips and would otherwise sit pending for ever) and the
  retention sweep.
- `services/validation-jobs/dispatcher.js` — claims, runs, records. `stop()`
  waits for in-flight jobs, so a redeploy finishes them rather than stranding
  them for a lease. It waits on the pass in progress, so never call `stop()`
  from inside a job.
- `services/upload/validate-layers-and-save.js` — the pipeline after the parse,
  shared by both entry points so they cannot drift.
- `services/validation-jobs/response-collector.js` — a stand-in for Hapi's
  toolkit so that shared pipeline runs unchanged outside a request.

A job row carries the enqueuing user's verified token **claims** (never the
token) because the worker runs outside any request and persistence is scoped to
the user's org context. Retention bounds how long they are held.

### What this does not do

Concurrency is capped per instance (`maxConcurrentJobs`, default 1), which
incidentally bounds how many GeoPackages are in memory at once — but nothing
bounds the queue itself, and the parsed layers still live on the heap through
the PostGIS checks.

## Tests

Two suites:

- **Unit** (`src/**/*.test.js`, `npm test`) — Drizzle is mocked. No external services. CI-default.
- **Integration** (`integration-tests/**/*.test.js`, `npm run test:integration`) — boots Hapi in-process via `server.inject` against a real Postgres, asserts side-effects (rows, triggers) with a raw `pg.Client`. Requires `docker compose up -d` locally; runs in CI via the `backend-integration-tests` job in `check-pull-request.yml`. See [`docs/integration-tests.md`](docs/integration-tests.md) for full details and the pattern for adding scenarios.

## Code style

- ESM only (`"type": "module"`).
- `import` statements come first — ESLint enforces `import-x/first`. In tests, place imports above `vi.mock()` calls; vitest hoists the mocks.
- **Always attempt to respect default SonarCloud conventions where possible** — write to them in the first draft rather than waiting for the scan to flag them. Code is scanned by SonarCloud (project key in `sonar-project.properties`); after pushing, run `/check-sonar-pr` for PR-scoped issues. Commonly flagged: brace every single-line `if`/`for` body (S121), extract magic numbers to named constants (S109), keep nesting ≤ 3 levels (S134), keep cognitive complexity per function low (S3776), prefer `replaceAll`/template literals over `replace`/concat, and remove dead/commented-out code (S125).
