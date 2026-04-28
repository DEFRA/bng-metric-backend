# bng-metric-backend

Hapi API on port 3001. Postgres (via Liquibase migrations) is the system of record; Drizzle ORM provides typed access; Joi validates JSONB payloads.

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

# 4. Tests
npm test
```

After local verification, push and open a PR — the **Check DB Schema** workflow re-runs migrations from scratch on a clean Postgres. Once merged, run **Publish DB Schema** from `main` and apply the published version through the CDP Portal (dev → test → ext-test → prod).

For the full end-to-end procedure, including changeset examples, JSONB handling, and the CDP Portal promotion steps, see [`docs/DATABASE_CHANGES.md`](docs/DATABASE_CHANGES.md). The reflection step is documented in [`docs/SCHEMA_REFLECTION.md`](docs/SCHEMA_REFLECTION.md).

## Code style

- ESM only (`"type": "module"`).
- `import` statements come first — ESLint enforces `import-x/first`. In tests, place imports above `vi.mock()` calls; vitest hoists the mocks.
