/**
 * Habitat sizes, taken straight off the back of validation.
 *
 * This used to be a second PostGIS round trip that re-parsed and re-repaired
 * every geometry purely to call ST_Area / ST_Length on it — a fourth pass over
 * shapes the validator had already parsed, repaired and measured. The GEOS
 * worker holds the repaired geometry at the moment it finishes checking, so the
 * numbers now cost a pointer dereference each and come back with the verdict.
 *
 * What is left here is the join. The worker keys its measurements by a feature's
 * position within its layer, because that is all it can know: `featureId` is
 * assigned on the main thread, after validation. {@link attachGeometrySizes}
 * puts the two together, and {@link calculateHabitatSizes} shapes the result the
 * document extract expects.
 */

const HABITAT_SIZE_LAYERS = ['areas', 'hedgerows', 'watercourses']

/**
 * Field the geometry engine's per-feature measurement is stamped onto, by
 * {@link attachGeometrySizes}. In-memory only, for the life of one request —
 * never persisted, and never read outside this module.
 */
const GEOMETRY_SIZE_FIELD = 'geometrySize'

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

/**
 * Add one feature's measurement to the result, under the shape the document
 * extract reads: areas carry a square-metre size, the linear layers a metre one.
 */
function appendSize(result, layerName, featureId, sizeValue) {
  const key = mapLayerToKey(layerName)
  if (!key) {
    return
  }
  if (key === 'areaHabitats') {
    result[key].individualSquareMetres.push({
      featureId,
      sizeSquareMetres: sizeValue
    })
    result[key].totalSquareMetres += sizeValue
  } else {
    result[key].individualMetres.push({ featureId, sizeMetres: sizeValue })
    result[key].totalMetres += sizeValue
  }
}

/**
 * Stamp the geometry engine's per-feature measurements onto the features they
 * belong to.
 *
 * Must run BEFORE the post-intervention path drops its Lost features, because
 * that filter changes the positions the measurements are keyed by. Sizes are a
 * pure function of geometry and the filter only ever removes features, so
 * measuring everything and then discarding some is correct.
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
 * Build the habitat-size result from the measurements the geometry engine made.
 *
 * Throws when a feature that should have been measured was not. That is
 * deliberately fatal rather than silently partial: recording some habitats with
 * a size and others without would corrupt the project document in a way nobody
 * would notice until the units came out wrong. The route turns it into a
 * SIZING_FAILED response.
 *
 * @param {object} layers layers carrying featureIds and stamped sizes
 * @returns {object}
 */
function calculateHabitatSizes(layers) {
  const result = emptyResult()

  for (const layerName of HABITAT_SIZE_LAYERS) {
    for (const feature of layers[layerName] ?? []) {
      if (!feature?.nativeGeometry) {
        continue
      }
      const sizeValue = feature[GEOMETRY_SIZE_FIELD]
      if (typeof sizeValue !== 'number') {
        throw new TypeError(
          `Geometry validation did not measure ${layerName} feature ${feature.featureId ?? '(no id)'}`
        )
      }
      appendSize(result, layerName, feature.featureId, sizeValue)
    }
  }

  return result
}

export {
  HABITAT_SIZE_LAYERS,
  GEOMETRY_SIZE_FIELD,
  attachGeometrySizes,
  calculateHabitatSizes
}
