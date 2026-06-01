import { randomUUID } from 'node:crypto'

import { PROP_KEYS, pickProp } from './properties.js'
import {
  areaStatus,
  hedgerowStatus,
  watercourseStatus
} from '../../services/baseline/calculate-habitat-statuses.js'

/**
 * @param {number | null | undefined} sizeSquareMetres
 * @returns {number | null}
 */
function areaFromSizeSquareMetres(sizeSquareMetres) {
  if (
    typeof sizeSquareMetres !== 'number' ||
    !Number.isFinite(sizeSquareMetres)
  ) {
    return null
  }
  return Math.round(sizeSquareMetres)
}

function buildHabitat(feature) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const habitatType = pickProp(props, PROP_KEYS.habitatType)
  const ref = pickProp(props, PROP_KEYS.parcelRef)

  // NOTE: distinctiveness and distinctivenessScore are not included here because
  // they are calculated separately by the metric engine.
  // NOTE2: area is set from PostGIS habitatSizes (sizeSquareMetres) in extractBaseline.

  const document = {
    featureId,
    ref,
    type: habitatType,
    broadType: pickProp(props, PROP_KEYS.broadHabitat),
    condition: pickProp(props, PROP_KEYS.condition),
    strategicSignificance: pickProp(props, PROP_KEYS.strategicSignificance),
    retentionCategory: pickProp(props, PROP_KEYS.retentionCategory),
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

function buildLinearFeature(
  feature,
  typeKey,
  extraProperties,
  statusForDocument
) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const ref = pickProp(props, PROP_KEYS.parcelRef)
  const extraDocumentProperties = Object.fromEntries(
    extraProperties.map(([name, keys]) => [name, pickProp(props, keys)])
  )

  const document = {
    featureId,
    ref,
    type: pickProp(props, typeKey),
    condition: pickProp(props, PROP_KEYS.condition),
    ...extraDocumentProperties,
    properties: props
  }
  document.status = statusForDocument(document)
  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

function buildHedgerow(feature) {
  return buildLinearFeature(feature, PROP_KEYS.hedgerowType, [], hedgerowStatus)
}

function buildWatercourse(feature) {
  return buildLinearFeature(
    feature,
    PROP_KEYS.riverType,
    [
      ['riparianEncroachment', PROP_KEYS.riparianEncroachment],
      ['watercourseEncroachment', PROP_KEYS.watercourseEncroachment]
    ],
    watercourseStatus
  )
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
 *   Per-feature transform, e.g. `buildHabitat` or a linear feature builder, that
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
 * @param {object[]} documents
 * @param {Array<{ featureId: string, sizeMetres: number }>} sizeEntries
 */
function embedLinearFeatureSizes(documents, sizeEntries) {
  const sizesByFeatureId = new Map(
    sizeEntries.map((entry) => [entry.featureId, entry.sizeMetres])
  )
  for (const document of documents) {
    document.sizeMetres = sizesByFeatureId.get(document.featureId) ?? null
  }
}

/**
 * @param {object} habitats
 * @param {object} hedgerows
 * @param {object} watercourses
 * @param {object} habitatSizes
 * @returns {object}
 */
function embedHabitatSizes(habitats, hedgerows, watercourses, habitatSizes) {
  const {
    areaHabitats,
    hedgerows: hedgerowSizes,
    watercourses: wcSizes
  } = habitatSizes

  const areaSizesByFeatureId = new Map(
    areaHabitats.individualSquareMetres.map((entry) => [
      entry.featureId,
      entry.sizeSquareMetres
    ])
  )
  for (const document of habitats.documents) {
    const sizeSquareMetres =
      areaSizesByFeatureId.get(document.featureId) ?? null
    document.sizeSquareMetres = sizeSquareMetres
    document.area = areaFromSizeSquareMetres(sizeSquareMetres)
  }

  embedLinearFeatureSizes(hedgerows.documents, hedgerowSizes.individualMetres)
  embedLinearFeatureSizes(watercourses.documents, wcSizes.individualMetres)

  return {
    areaHabitats: { totalSquareMetres: areaHabitats.totalSquareMetres },
    hedgerows: { totalMetres: hedgerowSizes.totalMetres },
    watercourses: { totalMetres: wcSizes.totalMetres }
  }
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
 * @param {string} [meta.filename]
 * @param {number} [meta.fileSize]
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
  const hedgerows = splitFeatures(layers.hedgerows ?? [], buildHedgerow)
  const watercourses = splitFeatures(
    layers.watercourses ?? [],
    buildWatercourse
  )

  // Embed the PostGIS-calculated size directly onto each feature document so
  // consumers (e.g. the frontend) can read habitat.sizeSquareMetres without a
  // secondary join. featureId is the join key between the sizes result and the documents.
  let habitatSizesSummary = null
  if (meta.habitatSizes) {
    habitatSizesSummary = embedHabitatSizes(
      habitats,
      hedgerows,
      watercourses,
      meta.habitatSizes
    )
  }

  return {
    document: {
      uploadId: meta.uploadId ?? null,
      filename: meta.filename ?? null,
      fileSize: meta.fileSize ?? null,
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
