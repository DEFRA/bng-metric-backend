import { randomUUID } from 'node:crypto'

import {
  distinctivenessScores,
  getDistinctiveness
} from './reference/habitat-distinctiveness.js'

// Property keys as written by Natural England QGIS templates. Lookups are
// case-insensitive (see pickProp) because some real-world files use
// underscored variants ("parcel_ref") or different casing.
const PROP_KEYS = {
  parcelRef: ['Parcel Ref', 'Parcel_Ref', 'parcel_ref'],
  habitatType: ['Baseline Habitat Type', 'Baseline_Habitat_Type'],
  broadHabitat: ['Baseline Broad Habitat Type', 'Baseline_Broad_Habitat_Type'],
  condition: ['Baseline Condition', 'Baseline_Condition'],
  strategicSignificance: [
    'Baseline Strategic Significance',
    'Baseline_Strategic_Significance'
  ],
  retentionCategory: ['Retention Category', 'Retention_Category'],
  area: ['Area', 'Shape_Area'],
  length: ['Length', 'Shape_Length']
}

function pickProp(properties, candidates) {
  if (!properties) {
    return null
  }
  for (const key of candidates) {
    if (key in properties && properties[key] != null) {
      return properties[key]
    }
  }
  const lowered = new Map(
    Object.keys(properties).map((k) => [k.toLowerCase(), k])
  )
  for (const key of candidates) {
    const hit = lowered.get(key.toLowerCase())
    if (hit && properties[hit] != null) {
      return properties[hit]
    }
  }
  return null
}

function buildHabitat(feature) {
  const featureId = randomUUID()
  const props = feature.properties ?? {}
  const habitatType = pickProp(props, PROP_KEYS.habitatType)
  const distinctiveness = getDistinctiveness(habitatType)
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
  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

function buildLinear(feature) {
  const featureId = randomUUID()
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
  const featureId = randomUUID()
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
  const watercourses = splitFeatures(layers.watercourses ?? [], buildLinear)

  return {
    document: {
      uploadId: meta.uploadId ?? null,
      importedAt: meta.importedAt ?? new Date().toISOString(),
      redLine: redLine.document,
      habitats: habitats.documents,
      hedgerows: hedgerows.documents,
      watercourses: watercourses.documents
    },
    geometries: {
      redLine: redLine.geometryRow,
      habitats: habitats.geometries,
      hedgerows: hedgerows.geometries,
      watercourses: watercourses.geometries
    }
  }
}
