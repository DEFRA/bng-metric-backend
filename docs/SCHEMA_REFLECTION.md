# Schema Reflection

This document serves as both **human documentation** and **AI agent instructions** for reflecting the PostgreSQL `bng` schema into application code. Any developer or AI coding agent can follow these steps to generate or update the Drizzle ORM table definitions and Joi validation schemas from the live database.

## Overview

Liquibase owns database migrations. The application layer maintains two sets of generated files that must stay in sync with the database:

- **Drizzle ORM table definitions** in `src/db/schema/` — a typed query layer over the Postgres tables
- **Joi validation schemas** in `src/validation/` — runtime validation for JSONB column data

When the database schema changes (new tables, new columns, altered types), re-run the reflection process described below to update these files.

## Prerequisites

- Local PostgreSQL running with the `bng` schema applied (see [DATABASE.md](DATABASE.md))
- `npm install` completed in `bng-metric-backend/`

The reflection script uses the same connection defaults as the application:

| Variable            | Default              |
| ------------------- | -------------------- |
| `DB_HOST`           | `localhost`          |
| `DB_PORT`           | `5432`               |
| `DB_DATABASE`       | `bng_metric_backend` |
| `DB_USER`           | `dev`                |
| `DB_LOCAL_PASSWORD` | `dev`                |

## Step 1 — Run the reflection script

From the `bng-metric-backend/` directory:

```sh
node scripts/reflect-schema.js
```

This connects to the local database, inspects every table in the `bng` schema, and outputs structured JSON covering:

- Column names, types, nullability, and defaults
- Primary keys and foreign keys
- Indexes (including GIST and GIN)
- PostGIS geometry column metadata (type, SRID) if present
- One sample row per JSONB column

The JSON output is the **source of truth** for the current database state. To reflect a different schema, pass the name as an argument: `node scripts/reflect-schema.js other_schema`.

## Step 2 — Generate or update Drizzle ORM schema files

For each table in the reflection output, create or update a file at `src/db/schema/<table_name>.js`.

### Type mapping

Map Postgres column types to Drizzle as follows:

| Postgres type                            | Drizzle column                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `uuid`                                   | `uuid()`                                                                       |
| `text`                                   | `text()`                                                                       |
| `int4` / `integer`                       | `integer()`                                                                    |
| `jsonb`                                  | `jsonb()`                                                                      |
| `timestamptz`                            | `timestamp({ withTimezone: true })`                                            |
| `bool`                                   | `boolean()`                                                                    |
| `numeric`                                | `numeric({ precision, scale })` — use values from reflection                   |
| `varchar`                                | `varchar({ length })` — use `maxLength` from reflection                        |
| `serial` / `int4` with `nextval` default | `serial()`                                                                     |
| `USER-DEFINED` with geometry metadata    | `geometry()` from `./custom-types.js` — use the reflected geometry type & SRID |

### Rules

- Use `pgSchema('bng')` — all tables live in the `bng` Postgres schema.
- Apply `.primaryKey()` to primary key columns.
- Apply `.notNull()` to non-nullable columns.
- Apply `.default()` or `.defaultNow()` for columns with defaults.
- Use **camelCase** for JS property names, **snake_case** strings for the DB column name argument.
- Add GIST indexes for geometry columns and GIN indexes for JSONB columns when the reflection shows them.
- Use ESM `import`/`export` syntax.
- Update `src/db/schema/index.js` to re-export all tables and the `geometry` custom type.

## Step 3 — Generate or update Joi validation schemas for JSONB columns

For each JSONB column that has sample data in the reflection output, create or update a file at `src/validation/<table_name>.js`.

### Type inference from sample data

Examine the sample JSONB data and build the Joi schema recursively:

| JSON value type    | Joi type                                    |
| ------------------ | ------------------------------------------- |
| `string`           | `Joi.string()`                              |
| `number` (integer) | `Joi.number().integer()`                    |
| `number` (decimal) | `Joi.number()`                              |
| `boolean`          | `Joi.boolean()`                             |
| `null`             | `Joi.any().allow(null)`                     |
| `array`            | `Joi.array().items()` — infer the item type |
| `object`           | `Joi.object({})` — recurse into keys        |

### Rules

- Export each named sub-schema separately so they can be reused (e.g. `siteSchema`, `unitsSchema`).
- **Do not** mark fields as `.required()` based on a single sample — the sample shows what exists, not what is mandatory. Keep fields optional by default. Developers tighten constraints (`.required()`, `.min()`, `.max()`, `.valid()`, `.pattern()`) as requirements become clear.
- If a Joi schema file already exists, **read it first**. Preserve any manually added constraints. Only add new fields or update types for fields whose type has changed.
- Import `Joi` from `'joi'`. Use ESM syntax.
- Update `src/validation/index.js` to re-export all validation schemas.

## Step 4 — Handle new and removed tables

- If the reflection shows a table that has no corresponding schema file, create it.
- If a schema file exists for a table no longer in the reflection output, **warn but do not delete** — it may have been kept intentionally.
- Apply the same logic to Joi validation files.

## Step 5 — Verify and summarise

After generating or updating all files, produce a summary of:

- Tables found in the database
- Files created or updated
- JSONB columns and whether sample data was available
- Any warnings (missing samples, removed tables, geometry columns detected)

## File layout

```
bng-metric-backend/
  scripts/
    reflect-schema.js            # Postgres reflection script (Step 1)
  src/
    db/
      schema/
        index.js                 # Barrel export
        custom-types.js          # PostGIS geometry type for Drizzle
        <table_name>.js          # One file per table
    validation/
      index.js                   # Barrel export
      <table_name>.js            # Joi schema per JSONB-bearing table
```

## Workflow

1. Write and apply a Liquibase changeset (new table, new column, altered type, etc.)
2. Follow steps 1-5 above (or ask an AI agent to do so using this document as instructions)
3. Review the generated diff
4. Commit the updated schema and validation files
