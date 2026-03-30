# Database Schema Management

This project uses [Liquibase](https://www.liquibase.org/) to manage the PostgreSQL database schema. Changesets are stored in the `changelog/` directory and follow DEFRA CDP platform conventions.

## Changelog Structure

```
changelog/
  db.changelog.xml          # Master changelog (CDP entry point)
  db.changelog-1.0.xml      # Initial schema: bng schema + projects table
```

- The master changelog (`db.changelog.xml`) includes all versioned changelogs via `<include>` elements.
- Each versioned file contains one or more changesets that are applied in order.

## Introducing Schema Changes

### 1. Create a new changelog file

Follow the naming convention `db.changelog-<version>.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog
    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">

    <changeSet id="1" author="bng-team">
        <comment>Add description of what this changeset does</comment>
        <!-- Your changes here -->
    </changeSet>

</databaseChangeLog>
```

### 2. Include it in the master changelog

Add an `<include>` element to `db.changelog.xml` **after** all existing includes:

```xml
<include file="db.changelog-1.1.xml" relativeToChangelogFile="true"/>
```

### 3. Raise a pull request

The `Check DB Schema` workflow will automatically validate your changelog and apply it against a clean PostgreSQL database.

### Best Practices

- **One logical change per changeset.** Don't combine unrelated DDL operations in a single changeset.
- **Never modify an applied changeset.** Liquibase tracks changesets by id + author + filepath hash. Modifying an applied changeset causes checksum validation failures. Instead, create a new changeset to alter the schema.
- **Use descriptive `<comment>` elements** in each changeset.
- **Prefer Liquibase XML tags** (`<addColumn>`, `<createIndex>`, `<createTable>`, etc.) over raw `<sql>` where possible — they support automatic rollback generation.

### Common Operations

**Add a column:**

```xml
<changeSet id="1" author="bng-team">
    <comment>Add updated_at column to projects table</comment>
    <addColumn schemaName="bng" tableName="projects">
        <column name="updated_at" type="timestamptz"/>
    </addColumn>
</changeSet>
```

**Create an index:**

```xml
<changeSet id="2" author="bng-team">
    <comment>Add index on user_id for projects table</comment>
    <createIndex schemaName="bng" tableName="projects" indexName="idx_projects_user_id">
        <column name="user_id"/>
    </createIndex>
</changeSet>
```

## Adding Dummy Data for Dev and Test Environments

The CDP platform sets an `$ENV` variable that maps to Liquibase contexts. Use the `context` attribute on changesets to control which environments they run in.

### Context Rules

| Context       | When It Runs                        |
| ------------- | ----------------------------------- |
| _(none)_      | All environments (always runs)      |
| `dev`         | Development environment only        |
| `test`        | Test environment only               |
| `dev or test` | Both dev and test environments      |
| `perf-test`   | Performance test environment only   |
| `!prod`       | Every environment except production |

### Example: Inserting Sample BNG Project Data

Create a separate changelog file for test data (e.g., `db.changelog-1.0-testdata.xml`) and include it in the master changelog. Keep test data separate from schema DDL.

Use `runOnChange="true"` on seed data changesets so the data can evolve over time — when you edit the changeset content, Liquibase will re-run it on the next apply. Pair each insert with a `<delete>` to clear stale rows first, since re-running a plain `<insert>` would fail on duplicate keys.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog
    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">

    <changeSet id="seed-test-data" author="bng-team" context="dev or test" runOnChange="true">
        <comment>Seed sample BNG projects for development and testing</comment>

        <delete schemaName="bng" tableName="projects">
            <where>user_id IN ('test-user-001', 'test-user-002')</where>
        </delete>

        <insert schemaName="bng" tableName="projects">
            <column name="id" valueComputed="gen_random_uuid()"/>
            <column name="project" value='{"name": "Greenfield Meadow Restoration", "site": {"name": "Greenfield Meadow", "grid_ref": "TQ 123 456"}, "units": {"habitat": 10.5, "hedgerow": 2.3, "watercourse": 0.8}}'/>
            <column name="user_id" value="test-user-001"/>
            <column name="bng_project_version" valueNumeric="1"/>
            <column name="created_at" valueComputed="now()"/>
        </insert>

        <insert schemaName="bng" tableName="projects">
            <column name="id" valueComputed="gen_random_uuid()"/>
            <column name="project" value='{"name": "Oakwood Farm BNG Assessment", "site": {"name": "Oakwood Farm", "grid_ref": "SP 987 654"}, "units": {"habitat": 25.0, "hedgerow": 8.1}}'/>
            <column name="user_id" value="test-user-002"/>
            <column name="bng_project_version" valueNumeric="2"/>
            <column name="created_at" valueComputed="now()"/>
        </insert>
    </changeSet>

</databaseChangeLog>
```

Then include it in `db.changelog.xml`:

```xml
<include file="db.changelog-1.0-testdata.xml" relativeToChangelogFile="true"/>
```

### Updating Seed Data

To change the test data, simply edit the `seed-test-data` changeset in place. Because `runOnChange="true"` is set, Liquibase will detect the checksum change and re-run the changeset on the next apply. The `<delete>` at the top clears the old rows before inserting the updated data.

> **Note:** Do not put dummy data inserts in the same file as schema DDL changesets.

## Testing Changelogs Locally

### Prerequisites

Start the local PostgreSQL database:

```bash
docker compose up postgres -d
```

### Using npm scripts (Recommended)

Apply migrations:

```bash
npm run db:update
```

Validate without applying:

```bash
npm run db:validate
```

These scripts use `scripts/liquibase.sh`, which runs Liquibase via Docker against the local Compose PostgreSQL. You can also call the script directly with any Liquibase command:

```bash
./scripts/liquibase.sh update
./scripts/liquibase.sh validate
./scripts/liquibase.sh status
```

### Verifying Changes

Connect to the database and inspect the schema:

```bash
# List schemas
docker compose exec postgres psql -U dev -d bng_metric_backend -c '\dn'

# List tables in bng schema
docker compose exec postgres psql -U dev -d bng_metric_backend -c '\dt bng.*'

# Describe the projects table
docker compose exec postgres psql -U dev -d bng_metric_backend -c '\d bng.projects'
```

### Resetting the Local Database

To start fresh (destroys all local data):

```bash
docker compose down -v
docker compose up postgres -d
```

Then re-run Liquibase to apply all migrations from scratch.

## Publishing Schema Changes to CDP

Schema migrations are published to the CDP platform separately from the application build:

1. Go to the repository's **Actions** tab on GitHub.
2. Select the **Publish DB Schema** workflow.
3. Click **Run workflow**.
4. Optionally provide a version tag (auto-generated if left blank).

Once published, apply the changelog to an environment via the [CDP Portal](https://portal.cdp-int.defra.cloud/apply-changelog).

> **Important:** Published changesets are immutable. You cannot overwrite an existing version.
