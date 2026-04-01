# Making Database Changes

An end-to-end guide for introducing data model changes — from local development through to production. Covers both Postgres column changes and JSONB field changes.

## Before you start

Understand the two types of change and which path to follow:

| Change type                                                                | Needs a Liquibase changeset?                  | Needs schema reflection?                                   |
| -------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| New/modified **Postgres column** (e.g. adding `updated_at`)                | Yes — new changeset required                  | Yes                                                        |
| New/modified **field inside a JSONB column** (e.g. adding `site.boundary`) | No DDL needed — the column is already `jsonb` | Yes — update test data, then reflect to update Joi schemas |

Both paths converge at the schema reflection step.

## Step 1 — Define the change in Liquibase

### Adding or modifying a Postgres column

Create a **new changelog file** following the naming convention `db.changelog-<version>.xml`. Never modify an applied changeset — Liquibase tracks changesets by checksum and will reject changes to ones already applied.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog
    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">

    <changeSet id="unique-id" author="bng-team">
        <comment>Describe what this changeset does and why</comment>
        <!-- Your change here -->
    </changeSet>

</databaseChangeLog>
```

Then include it in `changelog/db.changelog.xml` **after** all existing includes:

```xml
<include file="db.changelog-1.1.xml" relativeToChangelogFile="true"/>
```

#### Common operations

**Add a column:**

```xml
<changeSet id="1" author="bng-team">
    <comment>Add updated_at timestamp to projects table</comment>
    <addColumn schemaName="bng" tableName="projects">
        <column name="updated_at" type="timestamptz"/>
    </addColumn>
</changeSet>
```

**Create a table:**

```xml
<changeSet id="2" author="bng-team">
    <comment>Create habitats table</comment>
    <createTable schemaName="bng" tableName="habitats">
        <column name="id" type="uuid">
            <constraints primaryKey="true" nullable="false"/>
        </column>
        <column name="name" type="text">
            <constraints nullable="false"/>
        </column>
        <column name="boundary" type="geometry(Polygon, 27700)"/>
        <column name="details" type="jsonb"/>
    </createTable>
</changeSet>
```

**Create an index:**

```xml
<changeSet id="3" author="bng-team">
    <comment>Add spatial index on habitats boundary</comment>
    <sql>CREATE INDEX idx_habitats_boundary ON bng.habitats USING GIST (boundary);</sql>
</changeSet>
```

#### Best practices

- **One logical change per changeset.** Don't combine unrelated DDL in a single changeset.
- **Prefer Liquibase XML tags** (`<addColumn>`, `<createTable>`, `<createIndex>`) over raw `<sql>` where possible — they support automatic rollback generation. Use `<sql>` for Postgres-specific features like PostGIS indexes or custom types.
- **Use descriptive `<comment>` elements.** Future developers need to understand _why_ a change was made, not just what it does.
- **Include a `<rollback>` for raw SQL** — Liquibase cannot auto-generate rollbacks for `<sql>` tags.
- **Always include `schemaName="bng"`** on table operations. All application tables live in the `bng` schema.

### Adding or modifying a JSONB field

No Liquibase changeset is needed — the column type is already `jsonb`. Instead, update the test data changeset in `changelog/db.changelog-1.0-testdata.xml` to include the new field structure. Because this changeset uses `runOnChange="true"`, Liquibase will re-apply it when the content changes.

For example, to add a `boundary` field to the `site` object:

```xml
<column name="project" value='{"name": "Greenfield Meadow Restoration", "site": {"name": "Greenfield Meadow", "grid_ref": "TQ 123 456", "boundary": {"type": "Polygon", "coordinates": [...]}}, "units": {"habitat": 10.5, "hedgerow": 2.3, "watercourse": 0.8}}'/>
```

This updated test data will be used by the schema reflection step to generate the Joi validation schema.

## Step 2 — Apply the migration locally

Ensure your local Postgres is running:

```sh
docker compose up postgres -d
```

Apply migrations:

```sh
npm run db:update
```

Verify the change was applied:

```sh
npm run db:validate
```

## Step 3 — Run schema reflection

This step updates the Drizzle ORM table definitions and Joi validation schemas to match the current database state. See [SCHEMA_REFLECTION.md](SCHEMA_REFLECTION.md) for full details.

From the `bng-metric-backend/` directory:

```sh
node scripts/reflect-schema.js
```

Review the JSON output, then update the corresponding files:

- **Drizzle schemas** in `src/db/schema/` — add or update the table definition to match any new or changed columns
- **Joi validation schemas** in `src/validation/` — add or update Joi schemas for any JSONB columns whose structure has changed

If using an AI coding agent, point it at [SCHEMA_REFLECTION.md](SCHEMA_REFLECTION.md) which contains the step-by-step instructions and type mapping rules to perform this update automatically.

## Step 4 — Update and run tests

- Update or add unit tests that cover the new data fields
- If the change affects JSONB validation, add test cases for both valid and invalid payloads against the Joi schemas
- If the change adds new routes or modifies existing handlers, ensure integration tests cover the new behaviour

Run the full test suite:

```sh
npm test
```

Ensure all tests pass before proceeding.

## Step 5 — Create a Pull Request

Push your branch and create a PR. The **Check DB Schema** workflow runs automatically on every PR — it spins up a clean Postgres instance, validates the changelog, and applies all migrations from scratch. Your PR should include:

- The new or modified Liquibase changeset(s)
- Updated test data (if JSONB fields changed)
- Updated Drizzle schema file(s) in `src/db/schema/`
- Updated Joi validation file(s) in `src/validation/`
- New or updated tests
- Any application code that uses the new fields

The PR will not pass CI if the changelog is invalid or migrations fail to apply.

## Step 6 — Publish the schema from main

Once the PR is merged to `main`:

1. Go to the repository's **Actions** tab on GitHub
2. Select the **Publish DB Schema** workflow
3. Click **Run workflow** from the `main` branch
4. Optionally provide a version tag (auto-generated if left blank)

This packages the `changelog/` directory and publishes it to the CDP platform. Published changesets are immutable — you cannot overwrite an existing version.

## Step 7 — Apply the migration via CDP Portal

1. Log into the [CDP Portal](https://portal.cdp-int.defra.cloud)
2. Navigate to the changelog application page
3. Select the published schema version
4. Apply it to the **dev** environment first

See the [CDP Platform documentation](https://portal.cdp-int.defra.cloud/apply-changelog) for detailed instructions on applying changelogs.

## Step 8 — Test in the dev environment

After the migration has been applied to dev:

- Verify the application starts and connects to the database
- Test the new or changed functionality end to end
- Check logs for any database errors

## Step 9 — Promote through environments

Once verified in dev, apply the same published schema version to each subsequent environment as needed:

| Environment | When to apply                         |
| ----------- | ------------------------------------- |
| `dev`       | Immediately after publishing (Step 7) |
| `test`      | After verifying in dev                |
| `ext-test`  | Before external testing / UAT         |
| `perf-test` | Before performance testing            |
| `prod`      | After sign-off from all test stages   |

Apply the migration in each environment via the CDP Portal using the same published version. The application deployment and schema migration are independent — ensure the migration is applied **before** deploying application code that depends on the new schema (applies mainly to higher environments).

## Quick reference

```
1. Write changeset (or update JSONB test data)
2. npm run db:update
3. node scripts/reflect-schema.js  →  update Drizzle + Joi files
4. npm test
5. Push branch, create PR  →  CI validates changelog automatically
6. Merge to main
7. GitHub Actions  →  Publish DB Schema workflow
8. CDP Portal  →  apply to dev
9. Test in dev
10. CDP Portal  →  promote to test → ext-test → prod
```
