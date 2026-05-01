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

const DEFAULT_PORT = 5432

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number.parseInt(process.env.DB_PORT || String(DEFAULT_PORT), 10),
  database: process.env.DB_DATABASE || 'bng_metric_backend',
  user: process.env.DB_USER || 'dev',
  password: process.env.DB_LOCAL_PASSWORD || 'dev'
})

async function getPostgisGeometryColumns(client, schema) {
  try {
    const res = await client.query(
      `SELECT f_table_name, f_geometry_column, coord_dimension, srid, type
       FROM geometry_columns
       WHERE f_table_schema = $1`,
      [schema]
    )
    return res.rows
  } catch {
    // PostGIS not installed — no geometry columns
    return []
  }
}

async function getTables(client, schema) {
  const res = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema]
  )
  return res.rows.map((r) => r.table_name)
}

async function getColumnRows(client, schema, tableName) {
  const res = await client.query(
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
    [schema, tableName]
  )
  return res.rows
}

async function getPrimaryKeyColumns(client, schema, tableName) {
  const res = await client.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'PRIMARY KEY'`,
    [schema, tableName]
  )
  return new Set(res.rows.map((r) => r.column_name))
}

async function getForeignKeys(client, schema, tableName) {
  const res = await client.query(
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
    [schema, tableName]
  )
  return res.rows.map((fk) => ({
    column: fk.column_name,
    foreignSchema: fk.foreign_table_schema,
    foreignTable: fk.foreign_table_name,
    foreignColumn: fk.foreign_column_name
  }))
}

async function getIndexes(client, schema, tableName) {
  const res = await client.query(
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
    [schema, tableName]
  )
  return res.rows.map((i) => ({
    name: i.index_name,
    type: i.index_type,
    columns: i.columns,
    isUnique: i.is_unique
  }))
}

function buildColumn(c, pkColumns, geometryColumns, tableName) {
  const col = {
    name: c.column_name,
    dataType: c.data_type,
    udtName: c.udt_name,
    isNullable: c.is_nullable === 'YES',
    columnDefault: c.column_default,
    isPrimaryKey: pkColumns.has(c.column_name)
  }

  if (c.character_maximum_length) {
    col.maxLength = c.character_maximum_length
  }
  if (c.numeric_precision) {
    col.numericPrecision = c.numeric_precision
    col.numericScale = c.numeric_scale
  }

  const geom = geometryColumns.find(
    (g) => g.f_table_name === tableName && g.f_geometry_column === c.column_name
  )
  if (geom) {
    col.geometry = {
      type: geom.type,
      srid: geom.srid,
      coordDimension: geom.coord_dimension
    }
  }

  return col
}

async function getJsonbSample(client, schema, tableName, columnName) {
  const res = await client.query(
    `SELECT "${columnName}" FROM "${schema}"."${tableName}"
     WHERE "${columnName}" IS NOT NULL LIMIT 1`
  )
  return res.rows.length > 0 ? res.rows[0][columnName] : undefined
}

async function getJsonbSamples(client, schema, tableName, columns) {
  const samples = {}
  const jsonbColumns = columns.filter((c) => c.udtName === 'jsonb')
  for (const col of jsonbColumns) {
    const sample = await getJsonbSample(client, schema, tableName, col.name)
    if (sample !== undefined) {
      samples[col.name] = sample
    }
  }
  return samples
}

async function reflectTable(client, schema, tableName, geometryColumns) {
  const [columnRows, pkColumns, foreignKeys, indexes] = await Promise.all([
    getColumnRows(client, schema, tableName),
    getPrimaryKeyColumns(client, schema, tableName),
    getForeignKeys(client, schema, tableName),
    getIndexes(client, schema, tableName)
  ])
  const columns = columnRows.map((c) =>
    buildColumn(c, pkColumns, geometryColumns, tableName)
  )
  const jsonbSamples = await getJsonbSamples(client, schema, tableName, columns)

  return {
    schema,
    tableName,
    columns,
    foreignKeys,
    indexes,
    jsonbSamples
  }
}

async function reflectSchema(schema) {
  const client = await pool.connect()
  try {
    const [tableNames, geometryColumns] = await Promise.all([
      getTables(client, schema),
      getPostgisGeometryColumns(client, schema)
    ])
    const tables = []
    for (const tableName of tableNames) {
      tables.push(
        await reflectTable(client, schema, tableName, geometryColumns)
      )
    }
    return { schema, tables }
  } finally {
    client.release()
    await pool.end()
  }
}

const targetSchema = process.argv[2] || 'bng'
const reflected = await reflectSchema(targetSchema)
console.log(JSON.stringify(reflected, null, 2))
