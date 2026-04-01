/**
 * Reflects the PostgreSQL `bng` schema and outputs structured JSON describing
 * all tables, columns, constraints, indexes, and JSONB sample data.
 *
 * Usage:
 *   node scripts/reflect-schema.js [schema-name]
 *
 * Defaults to reflecting the `bng` schema. Uses the same DB connection
 * environment variables as the application (DB_HOST, DB_PORT, DB_DATABASE,
 * DB_USER, DB_LOCAL_PASSWORD).
 */
import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_DATABASE || 'bng_metric_backend',
  user: process.env.DB_USER || 'dev',
  password: process.env.DB_LOCAL_PASSWORD || 'dev'
})

async function getPostgisGeometryColumns(client, schemaName) {
  try {
    const result = await client.query(
      `SELECT f_table_name, f_geometry_column, coord_dimension, srid, type
       FROM geometry_columns
       WHERE f_table_schema = $1`,
      [schemaName]
    )
    return result.rows
  } catch {
    // PostGIS not installed — no geometry columns
    return []
  }
}

async function reflectSchema(schemaName) {
  const client = await pool.connect()
  try {
    // All tables in the schema
    const tablesResult = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schemaName]
    )

    // PostGIS geometry columns (if any)
    const geometryColumns = await getPostgisGeometryColumns(client, schemaName)

    const tables = []

    for (const { table_name: tableName } of tablesResult.rows) {
      // Columns
      const columnsResult = await client.query(
        `SELECT
           c.column_name,
           c.data_type,
           c.udt_name,
           c.is_nullable,
           c.column_default,
           c.character_maximum_length,
           c.numeric_precision,
           c.numeric_scale
         FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.table_name = $2
         ORDER BY c.ordinal_position`,
        [schemaName, tableName]
      )

      // Primary key columns
      const pkResult = await client.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = $1
           AND tc.table_name = $2
           AND tc.constraint_type = 'PRIMARY KEY'`,
        [schemaName, tableName]
      )
      const pkColumns = pkResult.rows.map((r) => r.column_name)

      // Foreign keys
      const fkResult = await client.query(
        `SELECT
           kcu.column_name,
           ccu.table_schema AS foreign_table_schema,
           ccu.table_name AS foreign_table_name,
           ccu.column_name AS foreign_column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
           AND ccu.table_schema = tc.table_schema
         WHERE tc.table_schema = $1
           AND tc.table_name = $2
           AND tc.constraint_type = 'FOREIGN KEY'`,
        [schemaName, tableName]
      )

      // Indexes (excluding primary key)
      const indexResult = await client.query(
        `SELECT
           i.relname AS index_name,
           am.amname AS index_type,
           array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns,
           ix.indisunique AS is_unique
         FROM pg_index ix
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_am am ON am.oid = i.relam
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
         WHERE n.nspname = $1 AND t.relname = $2
           AND NOT ix.indisprimary
         GROUP BY i.relname, am.amname, ix.indisunique`,
        [schemaName, tableName]
      )

      // Build column info with geometry metadata
      const columns = columnsResult.rows.map((c) => {
        const col = {
          name: c.column_name,
          dataType: c.data_type,
          udtName: c.udt_name,
          isNullable: c.is_nullable === 'YES',
          columnDefault: c.column_default,
          isPrimaryKey: pkColumns.includes(c.column_name)
        }

        if (c.character_maximum_length) {
          col.maxLength = c.character_maximum_length
        }
        if (c.numeric_precision) {
          col.numericPrecision = c.numeric_precision
          col.numericScale = c.numeric_scale
        }

        // Geometry metadata from PostGIS
        const geom = geometryColumns.find(
          (g) =>
            g.f_table_name === tableName &&
            g.f_geometry_column === c.column_name
        )
        if (geom) {
          col.geometry = {
            type: geom.type,
            srid: geom.srid,
            coordDimension: geom.coord_dimension
          }
        }

        return col
      })

      // Foreign key lookup
      const foreignKeys = fkResult.rows.map((fk) => ({
        column: fk.column_name,
        foreignSchema: fk.foreign_table_schema,
        foreignTable: fk.foreign_table_name,
        foreignColumn: fk.foreign_column_name
      }))

      // Sample JSONB data
      const jsonbColumns = columns.filter((c) => c.udtName === 'jsonb')
      const jsonbSamples = {}

      for (const col of jsonbColumns) {
        const sampleResult = await client.query(
          `SELECT "${col.name}" FROM "${schemaName}"."${tableName}"
           WHERE "${col.name}" IS NOT NULL LIMIT 1`
        )
        if (sampleResult.rows.length > 0) {
          jsonbSamples[col.name] = sampleResult.rows[0][col.name]
        }
      }

      tables.push({
        schema: schemaName,
        tableName,
        columns,
        foreignKeys,
        indexes: indexResult.rows.map((i) => ({
          name: i.index_name,
          type: i.index_type,
          columns: i.columns,
          isUnique: i.is_unique
        })),
        jsonbSamples
      })
    }

    return { schema: schemaName, tables }
  } finally {
    client.release()
    await pool.end()
  }
}

const schemaName = process.argv[2] || 'bng'
const result = await reflectSchema(schemaName)
console.log(JSON.stringify(result, null, 2))
