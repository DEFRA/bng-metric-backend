import { randomUUID } from 'node:crypto'

import {
  distinctivenessScores,
  getDistinctiveness
} from './reference/habitat-distinctiveness.js'
import { PROP_KEYS, buildHabitatLookupKey, pickProp } from './properties.js'
import {
  areaStatus,
  hedgerowStatus,
  watercourseStatus
} from '../../services/baseline/calculate-habitat-statuses.js'

function buildHabitat(feature) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const habitatType = pickProp(props, PROP_KEYS.habitatType)
  const distinctiveness = getDistinctiveness(buildHabitatLookupKey(props))
  const score = distinctiveness ? distinctivenessScores[distinctiveness] : null
  const ref = pickProp(props, PROP_KEYS.parcelRef)

  const document = {
    featureId,
    ref,
    type: habitatType,
    broadType: pickProp(props, PROP_KEYS.broadHabitat),
    distinctiveness,
    distinctivenessScore: score?.score ?? null,
    condition: pickProp(props, PROP_KEYS.condition),
    strategicSignificance: pickProp(props, PROP_KEYS.strategicSignificance),
    retentionCategory: pickProp(props, PROP_KEYS.retentionCategory),
    area: pickProp(props, PROP_KEYS.area),
    properties: props
  }
  document.status = areaStatus(document)
  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

function buildLinear(feature) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const ref = pickProp(props, PROP_KEYS.parcelRef)

  const document = {
    featureId,
    ref,
    type: pickProp(props, PROP_KEYS.habitatType),
    condition: pickProp(props, PROP_KEYS.condition),
    length: pickProp(props, PROP_KEYS.length),
    properties: props
  }
  document.status = hedgerowStatus(document)
  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

function buildWatercourse(feature) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const ref = pickProp(props, PROP_KEYS.parcelRef)

  const document = {
    featureId,
    ref,
    type: pickProp(props, PROP_KEYS.habitatType),
    condition: pickProp(props, PROP_KEYS.condition),
    riparianEncroachment: pickProp(props, PROP_KEYS.riparianEncroachment),
    watercourseEncroachment: pickProp(props, PROP_KEYS.watercourseEncroachment),
    length: pickProp(props, PROP_KEYS.length),
    properties: props
  }
  document.status = watercourseStatus(document)
  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

function buildRedLine(features) {
  const feature = features?.[0]
  if (!feature) {
    return { document: null, geometryRow: null }
  }
  const featureId = feature.featureId ?? randomUUID()
  return {
    document: {
      featureId,
      properties: feature.properties ?? {}
    },
    geometryRow: {
      featureId,
      geometry: feature.nativeGeometry,
      srid: feature.nativeSrid
    }
  }
}

/**
 * Map an array of parsed GeoPackage features into parallel `documents` and
 * `geometries` arrays, splitting attribute data from geometry.
 *
 * @param {object[]} features
 * @param {(feature: object) => { document: object, geometryRow: object }} builder
 *   Per-feature transform — one of `buildHabitat` or `buildLinear` — that
 *   returns the JSONB-bound document and the matching PostGIS geometry row.
 */
function splitFeatures(features, builder) {
  const documents = []
  const geometries = []
  for (const feature of features) {
    const { document, geometryRow } = builder(feature)
    documents.push(document)
    geometries.push(geometryRow)
  }
  return { documents, geometries }
}

/**
 * Shape an already-parsed `layers` object (from readBaselineGeoPackage) into
 * (a) the JSONB document persisted onto bng.projects.project.baseline (attribute
 * data only, no geometry), and (b) the parallel geometry rows for the four
 * bng.baseline_* PostGIS tables.
 *
 * Each feature is given a fresh UUID `featureId` that appears in both halves;
 * it is the join key between the JSONB document and the geometry tables.
 *
 * @param {object} layers
 * @param {object[]} layers.redline
 * @param {object[]} layers.areas
 * @param {object[]} layers.hedgerows
 * @param {object[]} layers.watercourses
 * @param {object} [meta]
 * @param {string} [meta.uploadId]
 * @param {string} [meta.importedAt] ISO timestamp; defaults to now
 * @param {object} [meta.habitatSizes] pre-calculated habitat sizes from calculateHabitatSizes
 * @returns {{
 *   document: object,
 *   geometries: {
 *     redLine: object|null,
 *     habitats: object[],
 *     hedgerows: object[],
 *     watercourses: object[]
 *   }
 * }}
 */
export function extractBaseline(layers, meta = {}) {
  const redLine = buildRedLine(layers.redline)
  const habitats = splitFeatures(layers.areas ?? [], buildHabitat)
  const hedgerows = splitFeatures(layers.hedgerows ?? [], buildLinear)
  const watercourses = splitFeatures(
    layers.watercourses ?? [],
    buildWatercourse
  )

  // Embed the PostGIS-calculated size directly onto each feature document so
  // consumers (e.g. the frontend) can read habitat.sizeSquareMetres without a
  // secondary join. featureId is the join key between the sizes result and the documents.
  let habitatSizesSummary = null
  if (meta.habitatSizes) {
    const { areaHabitats, hedgerows: hw, watercourses: wc } = meta.habitatSizes

    const areaSizes = new Map(
      areaHabitats.individualSquareMetres.map((s) => [
        s.featureId,
        s.sizeSquareMetres
      ])
    )
    habitats.documents.forEach((doc) => {
      doc.sizeSquareMetres = areaSizes.get(doc.featureId) ?? null
    })

    const hedgerowSizes = new Map(
      hw.individualMetres.map((s) => [s.featureId, s.sizeMetres])
    )
    hedgerows.documents.forEach((doc) => {
      doc.sizeMetres = hedgerowSizes.get(doc.featureId) ?? null
    })

    const watercourseSizes = new Map(
      wc.individualMetres.map((s) => [s.featureId, s.sizeMetres])
    )
    watercourses.documents.forEach((doc) => {
      doc.sizeMetres = watercourseSizes.get(doc.featureId) ?? null
    })

    habitatSizesSummary = {
      areaHabitats: { totalSquareMetres: areaHabitats.totalSquareMetres },
      hedgerows: { totalMetres: hw.totalMetres },
      watercourses: { totalMetres: wc.totalMetres }
    }
  }

  return {
    document: {
      uploadId: meta.uploadId ?? null,
      importedAt: meta.importedAt ?? new Date().toISOString(),
      redLine: redLine.document,
      habitats: habitats.documents,
      hedgerows: hedgerows.documents,
      watercourses: watercourses.documents,
      habitatSizes: habitatSizesSummary
    },
    geometries: {
      redLine: redLine.geometryRow,
      habitats: habitats.geometries,
      hedgerows: hedgerows.geometries,
      watercourses: watercourses.geometries
    }
  }
}
