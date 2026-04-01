import { customType } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * PostGIS geometry column type for Drizzle ORM.
 *
 * @param {string} geometryType - The geometry type (e.g. 'Point', 'Polygon', 'MultiPolygon')
 * @param {number} srid - The spatial reference ID (e.g. 27700 for British National Grid)
 * @returns {import('drizzle-orm/pg-core').PgCustomColumnBuilder}
 */
function geometry(geometryType, srid) {
  return customType({
    dataType() {
      return `geometry(${geometryType}, ${srid})`
    },
    toDriver(value) {
      return sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(value)}), ${sql.raw(String(srid))})`
    },
    fromDriver(value) {
      return value
    }
  })
}

export { geometry }
