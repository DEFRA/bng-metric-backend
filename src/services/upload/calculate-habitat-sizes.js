import { createLogger } from '../../common/helpers/logging/logger.js'
import {
  logPerf,
  perfNow,
  msSince
} from '../../common/helpers/perf-evidence.js'
import { toGeometryJson } from '../../validation/geopackage/geometry-json.js'

const logger = createLogger()

const HABITAT_SIZE_LAYERS = ['areas', 'hedgerows', 'watercourses']

/**
 * Field the geometry engine's per-feature measurement is stamped onto, by
 * {@link attachGeometrySizes}. In-memory only, for the life of one request —
 * never persisted, and never read by anything but this module.
 */
const GEOMETRY_SIZE_FIELD = 'geometrySize'

const CALCULATE_HABITAT_SIZES_QUERY = /* sql */ `
WITH features_in AS (
  SELECT layer,
         feature_id,
         ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), srid), 27700) AS geom
  FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])
    AS t(layer, feature_id, g, srid)
)
SELECT layer,
       feature_id,
       CASE
         WHEN layer = 'areas' THEN ST_Area(ST_MakeValid(geom))
         ELSE ST_Length(ST_MakeValid(geom))
       END AS size_value
FROM features_in
ORDER BY layer, feature_id
`

function buildLayerArrays(layers) {
  const layerNames = []
  const featureIds = []
  const geoms = []
  const srids = []

  for (const layerName of HABITAT_SIZE_LAYERS) {
    const features = layers[layerName] ?? []

    for (const feature of features) {
      if (!feature?.nativeGeometry) {
        continue
      }

      layerNames.push(layerName)
      featureIds.push(feature.featureId)
      geoms.push(toGeometryJson(feature.geometryJson, feature.nativeGeometry))
      srids.push(feature.nativeSrid)
    }
  }

  return { layerNames, featureIds, geoms, srids }
}

function emptyResult() {
  return {
    areaHabitats: {
      individualSquareMetres: [],
      totalSquareMetres: 0
    },
    hedgerows: {
      individualMetres: [],
      totalMetres: 0
    },
    watercourses: {
      individualMetres: [],
      totalMetres: 0
    }
  }
}

function mapLayerToKey(layerName) {
  if (layerName === 'areas') {
    return 'areaHabitats'
  }
  if (layerName === 'hedgerows') {
    return 'hedgerows'
  }
  if (layerName === 'watercourses') {
    return 'watercourses'
  }

  return null
}

function appendCalculatedSizes(result, rows) {
  for (const row of rows) {
    const key = mapLayerToKey(row.layer)
    if (!key) {
      continue
    }

    const sizeValue = Number(row.size_value)
    if (key === 'areaHabitats') {
      result[key].individualSquareMetres.push({
        featureId: row.feature_id,
        sizeSquareMetres: sizeValue
      })
      result[key].totalSquareMetres += sizeValue
    } else {
      result[key].individualMetres.push({
        featureId: row.feature_id,
        sizeMetres: sizeValue
      })
      result[key].totalMetres += sizeValue
    }
  }
}

/**
 * Stamp the geometry engine's per-feature measurements onto the features they
 * belong to.
 *
 * The engine returns sizes keyed by a feature's position within its layer,
 * because that is all a worker thread knows: `featureId` is assigned on the main
 * thread, after validation. This is where the two meet — and it has to happen
 * BEFORE the post-intervention path drops its Lost features, because that filter
 * changes the positions the sizes are keyed by.
 *
 * Sizes are a pure function of geometry and the filter only ever removes
 * features, so measuring everything and then discarding some is correct.
 *
 * @param {object} layers layers with featureIds already assigned
 * @param {Record<string, Array<{ idx: number, value: number }>>} [sizes]
 * @returns {object} a new layers object; the input is left untouched
 */
function attachGeometrySizes(layers, sizes) {
  if (!sizes) {
    return layers
  }
  const stamped = { ...layers }
  for (const layerName of HABITAT_SIZE_LAYERS) {
    const byIdx = new Map(
      (sizes[layerName] ?? []).map((entry) => [entry.idx, entry.value])
    )
    stamped[layerName] = (layers[layerName] ?? []).map((feature, index) =>
      byIdx.has(index)
        ? { ...feature, [GEOMETRY_SIZE_FIELD]: byIdx.get(index) }
        : feature
    )
  }
  return stamped
}

/**
 * Build the sizing result from measurements the geometry engine already made,
 * or return null if it did not make them all.
 *
 * The all-or-nothing rule is deliberate: a partial result would silently record
 * some habitats with a size and others without, which is far worse than paying
 * for one more PostGIS round trip. Anything unexpected — the PostGIS engine ran,
 * a worker fell back, a caller assembled layers by hand — lands on the query.
 *
 * @param {object} layers
 * @returns {object|null}
 */
function habitatSizesFromGeometry(layers) {
  const result = emptyResult()
  let measured = 0

  for (const layerName of HABITAT_SIZE_LAYERS) {
    for (const feature of layers[layerName] ?? []) {
      if (!feature?.nativeGeometry) {
        continue
      }
      const sizeValue = feature[GEOMETRY_SIZE_FIELD]
      if (typeof sizeValue !== 'number') {
        return null
      }
      appendCalculatedSizes(result, [
        {
          layer: layerName,
          feature_id: feature.featureId,
          size_value: sizeValue
        }
      ])
      measured++
    }
  }

  return measured === 0 ? null : result
}

async function calculateHabitatSizes(pool, layers) {
  // The geometry engine holds the repaired geometry for every one of these
  // features by the time the checks have finished, so when it has handed the
  // measurements over there is nothing left to ask PostGIS for — no query, no
  // connection, and no fourth parse of the same shapes.
  const fromGeometry = habitatSizesFromGeometry(layers)
  if (fromGeometry) {
    return fromGeometry
  }

  if (!pool) {
    throw new Error('calculateHabitatSizes requires a pg pool')
  }

  const { layerNames, featureIds, geoms, srids } = buildLayerArrays(layers)

  if (layerNames.length === 0) {
    return emptyResult()
  }

  const queryStart = perfNow()
  const { rows } = await pool.query(CALCULATE_HABITAT_SIZES_QUERY, [
    layerNames,
    featureIds,
    geoms,
    srids
  ])
  // Evidence (Item 6 — the sizing pass overlaps a second PostGIS round trip):
  // a separate awaited query that recomputes ST_MakeValid per feature,
  // duplicating the geometry-repair work the validation statement already did.
  logPerf(logger, 'postgis-sizing-query', {
    featureCount: geoms.length,
    queryMs: msSince(queryStart)
  })

  const result = emptyResult()
  appendCalculatedSizes(result, rows)
  return result
}

export {
  HABITAT_SIZE_LAYERS,
  CALCULATE_HABITAT_SIZES_QUERY,
  GEOMETRY_SIZE_FIELD,
  attachGeometrySizes,
  buildLayerArrays,
  calculateHabitatSizes,
  habitatSizesFromGeometry
}
