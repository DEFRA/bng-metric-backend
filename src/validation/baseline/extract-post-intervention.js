import { randomUUID } from 'node:crypto'

import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-metric-engine'

import { PROP_KEYS, PROPOSED_PROP_KEYS, pickProp } from './properties.js'
import {
  postInterventionAreaStatus,
  postInterventionHedgerowStatus,
  postInterventionWatercourseStatus
} from '../../services/baseline/calculate-habitat-statuses.js'
import { stripConditionPrefix } from '../../utilities/baseline/condition.js'

/** GeoPackage literal when advance/delay columns do not apply (Lost features). */
const GPKG_NOT_APPLICABLE = 'N/A'

/**
 * @param {object} feature
 * @returns {{ featureId: string, props: object, ref: string | null }}
 */
function initParsedFeature(feature) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  return {
    featureId,
    props,
    ref: pickProp(props, PROP_KEYS.parcelRef)
  }
}

/**
 * @param {object} feature
 * @param {string} featureId
 * @param {string | null} ref
 */
function buildGeometryRow(feature, featureId, ref) {
  return {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    srid: feature.nativeSrid
  }
}

/**
 * @param {object} props
 * @param {string[]} advanceDelayKeys
 */
function buildAdvanceDelayFields(props, advanceDelayKeys = PROPOSED_PROP_KEYS) {
  const rawAdvance = pickProp(props, advanceDelayKeys.advanceYears)
  const rawDelay = pickProp(props, advanceDelayKeys.delayYears)
  return {
    advanceYears: parseProposedAdvanceDelayYears(rawAdvance),
    delayYears: parseProposedAdvanceDelayYears(rawDelay)
  }
}

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
  } else {
    return Math.round(sizeSquareMetres)
  }
}

/**
 * Parse "Habitat created in advance/years" / "Delay in starting habitat
 * creation/years" from the GeoPackage. NE template files use the literal
 * "N/A" for Lost linear features (and some Lost area rows) where advance/delay
 * do not apply; those map to null. Missing columns default to 0.
 *
 * @param {unknown} rawValue
 * @returns {number | null}
 */
function parseProposedAdvanceDelayYears(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return 0
  } else if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? rawValue : null
  } else if (typeof rawValue === 'string') {
    const normalized = rawValue.trim()
    if (normalized.toUpperCase() === GPKG_NOT_APPLICABLE) {
      return null
    } else if (normalized === MAX_YEARS_PLUS) {
      return MAX_YEARS
    } else {
      const num = Number(normalized)
      return Number.isFinite(num) ? num : null
    }
  } else {
    return null
  }
}

/**
 * Build the `baseline` sub-object for a post-intervention area habitat from raw
 * GeoPackage properties. Reads the "Baseline *" columns.
 *
 * @param {object} props
 * @returns {object}
 */
function buildAreaBaselineSubObject(props) {
  return {
    type: pickProp(props, PROP_KEYS.habitatType),
    broadType: pickProp(props, PROP_KEYS.broadHabitat),
    condition: stripConditionPrefix(pickProp(props, PROP_KEYS.condition)),
    conditionScore: null,
    distinctiveness: null,
    distinctivenessScore: null,
    strategicSignificance: pickProp(props, PROP_KEYS.strategicSignificance),
    retentionCategory: pickProp(props, PROP_KEYS.retentionCategory)
  }
}

/**
 * Build the `proposed` sub-object for a post-intervention area habitat.
 * Reads the "Proposed *" columns plus advance/delay years.
 *
 * @param {object} props
 * @returns {object}
 */
function buildAreaProposedSubObject(props) {
  return {
    type: pickProp(props, PROPOSED_PROP_KEYS.habitatType),
    broadType: pickProp(props, PROPOSED_PROP_KEYS.broadHabitat),
    condition: stripConditionPrefix(
      pickProp(props, PROPOSED_PROP_KEYS.condition)
    ),
    conditionScore: null,
    distinctiveness: null,
    distinctivenessScore: null,
    strategicSignificance: pickProp(
      props,
      PROPOSED_PROP_KEYS.strategicSignificance
    ),
    ...buildAdvanceDelayFields(props)
  }
}

/**
 * Build the `baseline` sub-object for a post-intervention linear feature
 * (hedgerow or watercourse) from raw GeoPackage properties.
 *
 * @param {object} props
 * @param {string[]} typeKey - PROP_KEYS key array for the baseline type column
 * @returns {object}
 */
function buildLinearBaselineSubObject(props, typeKey) {
  return {
    type: pickProp(props, typeKey),
    condition: stripConditionPrefix(pickProp(props, PROP_KEYS.condition)),
    conditionScore: null,
    distinctiveness: null,
    distinctivenessScore: null
  }
}

/**
 * Build the `proposed` sub-object for a post-intervention linear feature.
 *
 * @param {object} props
 * @param {string[]} typeKey - PROPOSED_PROP_KEYS key array for the proposed type column
 * @returns {object}
 */
function buildLinearProposedSubObject(props, typeKey) {
  return {
    type: pickProp(props, typeKey),
    condition: stripConditionPrefix(
      pickProp(props, PROPOSED_PROP_KEYS.condition)
    ),
    conditionScore: null,
    distinctiveness: null,
    distinctivenessScore: null,
    ...buildAdvanceDelayFields(props)
  }
}

function buildPostInterventionFeature(feature, buildDocument, statusFn) {
  const { featureId, props, ref } = initParsedFeature(feature)
  const document = buildDocument(featureId, ref, props)
  document.status = statusFn(document)
  return {
    document,
    geometryRow: buildGeometryRow(feature, featureId, ref)
  }
}

function buildPostInterventionHabitat(feature) {
  return buildPostInterventionFeature(
    feature,
    (featureId, ref, props) => ({
      featureId,
      ref,
      area: null,
      sizeSquareMetres: null,
      units: null,
      status: null,
      baseline: buildAreaBaselineSubObject(props),
      proposed: buildAreaProposedSubObject(props),
      properties: props
    }),
    postInterventionAreaStatus
  )
}

function buildPostInterventionHedgerow(feature) {
  return buildPostInterventionFeature(
    feature,
    (featureId, ref, props) => ({
      featureId,
      ref,
      length: null,
      sizeMetres: null,
      units: null,
      status: null,
      baseline: buildLinearBaselineSubObject(props, PROP_KEYS.hedgerowType),
      proposed: buildLinearProposedSubObject(
        props,
        PROPOSED_PROP_KEYS.hedgerowType
      ),
      properties: props
    }),
    postInterventionHedgerowStatus
  )
}

/**
 * Build the watercourse encroachment sub-fields for either baseline or proposed side.
 *
 * @param {object} props
 * @param {string[]} riparianKey
 * @param {string[]} watercourseKey
 * @param {string[]} strategicKey
 * @returns {object}
 */
function buildWatercourseEncroachmentFields(
  props,
  riparianKey,
  watercourseKey,
  strategicKey
) {
  return {
    riparianEncroachment: pickProp(props, riparianKey),
    watercourseEncroachment: pickProp(props, watercourseKey),
    strategicSignificance: pickProp(props, strategicKey)
  }
}

function buildPostInterventionWatercourse(feature) {
  return buildPostInterventionFeature(
    feature,
    (featureId, ref, props) => {
      const baselineEncroachments = buildWatercourseEncroachmentFields(
        props,
        PROP_KEYS.riparianEncroachment,
        PROP_KEYS.watercourseEncroachment,
        PROP_KEYS.strategicSignificance
      )
      const proposedEncroachments = buildWatercourseEncroachmentFields(
        props,
        PROPOSED_PROP_KEYS.riparianEncroachment,
        PROPOSED_PROP_KEYS.watercourseEncroachment,
        PROPOSED_PROP_KEYS.strategicSignificance
      )

      return {
        featureId,
        ref,
        length: null,
        sizeMetres: null,
        units: null,
        status: null,
        baseline: {
          type: pickProp(props, PROP_KEYS.riverType),
          condition: stripConditionPrefix(pickProp(props, PROP_KEYS.condition)),
          conditionScore: null,
          distinctiveness: null,
          distinctivenessScore: null,
          ...baselineEncroachments
        },
        proposed: {
          type: pickProp(props, PROPOSED_PROP_KEYS.riverType),
          condition: stripConditionPrefix(
            pickProp(props, PROPOSED_PROP_KEYS.condition)
          ),
          conditionScore: null,
          distinctiveness: null,
          distinctivenessScore: null,
          ...buildAdvanceDelayFields(props),
          ...proposedEncroachments
        },
        properties: props
      }
    },
    postInterventionWatercourseStatus
  )
}

/**
 * Split an array of parsed GeoPackage features into `documents` and `geometries`
 * using the supplied per-feature builder.
 *
 * @param {object[]} features
 * @param {(feature: object) => { document: object, geometryRow: object }} builder
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
    document.length =
      typeof document.sizeMetres === 'number'
        ? Math.round(document.sizeMetres)
        : null
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

function buildRedLine(features) {
  const feature = features?.[0]
  if (feature) {
    const { featureId, props } = initParsedFeature(feature)
    return {
      document: {
        featureId,
        properties: props
      },
      geometryRow: {
        featureId,
        geometry: feature.nativeGeometry,
        srid: feature.nativeSrid
      }
    }
  } else {
    return { document: null, geometryRow: null }
  }
}

/**
 * Shape an already-parsed `layers` object into the post-intervention JSONB
 * document (nested baseline/proposed per feature) and parallel geometry rows.
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
 * @returns {{ document: object, geometries: object }}
 */
export function extractPostIntervention(layers, meta = {}) {
  const redLine = buildRedLine(layers.redline)
  const habitats = splitFeatures(
    layers.areas ?? [],
    buildPostInterventionHabitat
  )
  const hedgerows = splitFeatures(
    layers.hedgerows ?? [],
    buildPostInterventionHedgerow
  )
  const watercourses = splitFeatures(
    layers.watercourses ?? [],
    buildPostInterventionWatercourse
  )

  const habitatSizesSummary = meta.habitatSizes
    ? embedHabitatSizes(habitats, hedgerows, watercourses, meta.habitatSizes)
    : null

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
