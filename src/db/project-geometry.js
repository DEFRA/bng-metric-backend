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
 *
 * Every layer read is CAPPED (`report.maxFeaturesPerLayer`). Nothing upstream
 * bounds how many features a project may hold, and the report that consumes
 * these rows holds its whole document in memory, so an unbounded read is the
 * one place a single project could cost the process an arbitrary amount of
 * both. The cap is applied in SQL rather than after the fact, so the rows
 * above it are never materialised here; the caller is told which layers hit
 * it so the document can say so instead of silently showing a subset.
 */

import { areaSquareMetres } from 'bng-library/measure'
import { eq, sql } from 'drizzle-orm'

import { config } from '../config.js'

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

/**
 * Enough decimal places to reproduce any grid coordinate exactly: PostGIS
 * prints the shortest digits that round-trip, up to this many.
 */
const EXACT_GEOJSON_DECIMALS = 15

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
async function readLayerGeometry(drizzle, table, projectId, limit) {
  // One row past the ceiling, which is what turns "we read 500" into the two
  // distinguishable answers "the layer has 500" and "the layer has more".
  const rows = await drizzle
    .select({
      featureId: table.id,
      geoJson: geoJsonColumn(table).as('geojson')
    })
    .from(table)
    .where(eq(table.projectId, projectId))
    .orderBy(table.id)
    .limit(limit + 1)

  const capped = rows.length > limit
  return {
    capped,
    features: (capped ? rows.slice(0, limit) : rows).map((row) => ({
      featureId: row.featureId,
      geometry: JSON.parse(row.geoJson)
    }))
  }
}

/**
 * The red line, with its area.
 *
 * No document field holds the area: the red line is a boundary, not a habitat,
 * so it carries no `sizeSquareMetres`. It is measured here with
 * bng-library/measure, the same function that measured every parcel on upload
 * (validation/geopackage/geos/sizes.js), so the red line and the parcels are
 * sized by one definition.
 *
 * The drawing geometry is rounded to the millimetre, which is plenty for a map
 * but not for an area, so the area is measured from a second copy at full
 * precision: 15 decimal places reproduce grid coordinates exactly.
 */
async function readRedLine(drizzle, table, projectId) {
  const rows = await drizzle
    .select({
      geoJson: geoJsonColumn(table).as('geojson'),
      exactGeoJson:
        sql`ST_AsGeoJSON(${table.geom}, ${EXACT_GEOJSON_DECIMALS})`.as(
          'exact_geojson'
        )
    })
    .from(table)
    .where(eq(table.projectId, projectId))
    .limit(1)

  if (rows.length === 0) {
    return { redLine: null, redLineAreaSqm: 0 }
  }
  return {
    redLine: { geometry: JSON.parse(rows[0].geoJson) },
    redLineAreaSqm: areaSquareMetres(JSON.parse(rows[0].exactGeoJson))
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
 * @param {object} [options]
 * @param {number} [options.maxFeaturesPerLayer]  overrides the configured cap
 * @returns {Promise<{ redLine: object|null, redLineAreaSqm: number,
 *                     layers: object, cappedLayers: string[],
 *                     maxFeaturesPerLayer: number }>}
 */
async function readProjectGeometry(
  drizzle,
  projectId,
  documentKey,
  { maxFeaturesPerLayer = config.get('report.maxFeaturesPerLayer') } = {}
) {
  const tables = FEATURE_TABLES[documentKey]
  if (!tables) {
    throw new Error(`Unknown document key "${documentKey}"`)
  }

  const [redLine, ...layers] = await Promise.all([
    readRedLine(drizzle, tables.redLine, projectId),
    ...GEOMETRY_LAYERS.map((layer) =>
      readLayerGeometry(drizzle, tables[layer], projectId, maxFeaturesPerLayer)
    )
  ])

  const byLayer = {}
  const cappedLayers = []
  GEOMETRY_LAYERS.forEach((layer, index) => {
    byLayer[layer] = layers[index].features
    if (layers[index].capped) {
      cappedLayers.push(layer)
    }
  })

  return { ...redLine, layers: byLayer, cappedLayers, maxFeaturesPerLayer }
}

export { FEATURE_TABLES, GEOMETRY_LAYERS, readProjectGeometry }
