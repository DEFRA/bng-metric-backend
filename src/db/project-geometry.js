/**
 * Reading a project's stored geometry back out of PostGIS, as GeoJSON.
 *
 * This is the source the site report draws from — deliberately, and in
 * preference to the uploaded GeoPackage. The file is what the user supplied
 * once; these rows are what they have since edited through
 * `PUT /projects/{id}/features/{featureId}`, so the file can be stale while
 * these cannot.
 *
 * Two facts make the join to the project document trivial:
 *
 *  - the geometry row's primary key IS the document's `featureId`
 *    (see `geometryRowValues` in services/upload/persist-upload.js), so
 *    attributes and shape are matched by id, never by ref or by ordering;
 *  - every column is `geometry(..., 27700)`, so no reprojection happens on
 *    read and the coordinates the report draws are the coordinates stored.
 *
 * `ST_AsGeoJSON` is asked for a fixed 3 decimal places — millimetres on the
 * British National Grid. The default is 9, which spends about 40% of the
 * payload on digits no map can render and no survey can justify.
 */

import { eq, sql } from 'drizzle-orm'

import {
  baselineHabitats,
  baselineHedgerows,
  baselineRedLine,
  baselineTrees,
  baselineWatercourses,
  postInterventionHabitats,
  postInterventionHedgerows,
  postInterventionRedLine,
  postInterventionTrees,
  postInterventionWatercourses
} from './schema/index.js'

/** Millimetre precision on a grid measured in metres. */
const GEOJSON_DECIMALS = 3

const FEATURE_TABLES = Object.freeze({
  baseline: {
    redLine: baselineRedLine,
    habitats: baselineHabitats,
    hedgerows: baselineHedgerows,
    watercourses: baselineWatercourses,
    trees: baselineTrees
  },
  postIntervention: {
    redLine: postInterventionRedLine,
    habitats: postInterventionHabitats,
    hedgerows: postInterventionHedgerows,
    watercourses: postInterventionWatercourses,
    trees: postInterventionTrees
  }
})

/** The layers carrying many features, in the order the report draws them. */
const GEOMETRY_LAYERS = Object.freeze([
  'habitats',
  'hedgerows',
  'watercourses',
  'trees'
])

function geoJsonColumn(table) {
  return sql`ST_AsGeoJSON(${table.geom}, ${GEOJSON_DECIMALS})`
}

/**
 * Every feature of one layer, as `{ featureId, geometry }`.
 *
 * Ordered by id so a report built twice from unchanged data draws its parcels
 * in the same order both times — the tests compare documents, and an
 * unordered read would make them compare a set to a sequence.
 */
async function readLayerGeometry(drizzle, table, projectId) {
  const rows = await drizzle
    .select({
      featureId: table.id,
      geoJson: geoJsonColumn(table).as('geojson')
    })
    .from(table)
    .where(eq(table.projectId, projectId))
    .orderBy(table.id)

  return rows.map((row) => ({
    featureId: row.featureId,
    geometry: JSON.parse(row.geoJson)
  }))
}

/**
 * The red line, with its area.
 *
 * The area comes from `ST_Area` rather than from the document because no
 * document field holds it: the red line is a boundary, not a habitat, so it
 * carries no `sizeSquareMetres`. PostGIS is also the right place to ask —
 * it is the same engine that computed every parcel size on upload
 * (services/upload/calculate-habitat-sizes.js), so the two agree by
 * construction.
 */
async function readRedLine(drizzle, table, projectId) {
  const rows = await drizzle
    .select({
      geoJson: geoJsonColumn(table).as('geojson'),
      areaSqm: sql`ST_Area(${table.geom})`.as('area_sqm')
    })
    .from(table)
    .where(eq(table.projectId, projectId))
    .limit(1)

  if (rows.length === 0) {
    return { redLine: null, redLineAreaSqm: 0 }
  }
  return {
    redLine: { geometry: JSON.parse(rows[0].geoJson) },
    redLineAreaSqm: Number(rows[0].areaSqm)
  }
}

/**
 * All the geometry one document side holds, keyed by layer.
 *
 * The caller has already established that the project is visible to the
 * requesting user — these tables carry no user column of their own, so they
 * are never queried except behind a visibility check on `projects`.
 *
 * @param {object} drizzle
 * @param {string} projectId
 * @param {'baseline'|'postIntervention'} documentKey
 */
async function readProjectGeometry(drizzle, projectId, documentKey) {
  const tables = FEATURE_TABLES[documentKey]
  if (!tables) {
    throw new Error(`Unknown document key "${documentKey}"`)
  }

  const [redLine, ...layers] = await Promise.all([
    readRedLine(drizzle, tables.redLine, projectId),
    ...GEOMETRY_LAYERS.map((layer) =>
      readLayerGeometry(drizzle, tables[layer], projectId)
    )
  ])

  const byLayer = {}
  GEOMETRY_LAYERS.forEach((layer, index) => {
    byLayer[layer] = layers[index]
  })

  return { ...redLine, layers: byLayer }
}

export { FEATURE_TABLES, GEOMETRY_LAYERS, readProjectGeometry }
