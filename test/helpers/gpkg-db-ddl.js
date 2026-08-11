export function createSystemTables(db) {
  db.exec(`
    CREATE TABLE gpkg_spatial_ref_sys (
      srs_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL PRIMARY KEY,
      organization TEXT NOT NULL,
      organization_coordsys_id INTEGER NOT NULL,
      definition TEXT NOT NULL,
      description TEXT
    )
  `)
  db.exec(`
    CREATE TABLE gpkg_contents (
      table_name TEXT NOT NULL PRIMARY KEY,
      data_type TEXT NOT NULL,
      identifier TEXT UNIQUE,
      description TEXT DEFAULT '',
      last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      min_x REAL, min_y REAL, max_x REAL, max_y REAL,
      srs_id INTEGER
    )
  `)
  db.exec(`
    CREATE TABLE gpkg_geometry_columns (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      geometry_type_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL,
      z TINYINT NOT NULL,
      m TINYINT NOT NULL,
      CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name)
    )
  `)
}

/**
 * Quotes a SQLite double-quoted identifier (used in DDL for table/column names).
 * @param {string} name
 */
export function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`
}

/**
 * @param {object} layerDef Baseline schema layer descriptor (matches `gpkg-template.schema.json`).
 */
export function createLayerTableDDL(layerDef) {
  const parts = layerDef.columns.map((c) => {
    let clause = `${quoteIdent(c.name)} ${c.sqliteType}`
    if (c.primaryKey) {
      clause += ' NOT NULL PRIMARY KEY'
    } else if (c.notNull) {
      clause += ' NOT NULL'
    } else {
      // nullable, non-primary-key column — nothing after SQLite type keyword
    }
    return clause
  })
  return `CREATE TABLE ${quoteIdent(layerDef.tableName)} (${parts.join(', ')})`
}
