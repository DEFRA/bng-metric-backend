import { randomUUID } from 'node:crypto'

import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-metric-engine'

import { PROP_KEYS, PROPOSED_PROP_KEYS, pickProp } from './properties.js'
import {
  postInterventionAreaStatus,
  postInterventionHedgerowStatus,
  postInterventionWatercourseStatus
} from '../../services/baseline/calculate-habitat-statuses.js'
import {
  INDIVIDUAL_TREES_BROAD_HABITAT,
  treeHabitatTypeFromRuralUrban
} from './tree-constants.js'
import { treeAreaFields, summarizeTreeSizes } from './tree-sizes.js'
import {
  embedParcelSizes,
  buildHabitatSizesSummary,
  buildExtractResult
} from './extract-shared.js'
import { stripConditionPrefix } from '../../utilities/baseline/condition.js'

// Tree columns differ between the baseline and proposed sides exactly like the
// other habitat columns: the baseline sub-object reads the "Baseline *" tree
// columns, the proposed sub-object the "Proposed *" tree columns.
const BASELINE_TREE_KEYS = {
  treeSize: PROP_KEYS.treeSize,
  treeType: PROP_KEYS.treeType,
  ruralOrUrbanTree: PROP_KEYS.ruralOrUrbanTree,
  condition: PROP_KEYS.condition,
  strategicSignificance: PROP_KEYS.strategicSignificance
}
const PROPOSED_TREE_KEYS = {
  treeSize: PROP_KEYS.proposedTreeSize,
  treeType: PROP_KEYS.proposedTreeType,
  ruralOrUrbanTree: PROP_KEYS.proposedRuralOrUrbanTree,
  condition: PROPOSED_PROP_KEYS.condition,
  strategicSignificance: PROPOSED_PROP_KEYS.strategicSignificance
}

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

/**
 * Build one side (baseline or proposed) of a post-intervention individual tree.
 * Trees are points, so each side carries its own notional area derived from that
 * side's tree-size band (the baseline and proposed sizes can differ).
 *
 * @param {object} props
 * @param {{ treeSize: string[], treeType: string[], ruralOrUrbanTree: string[], condition: string[], strategicSignificance: string[] }} keys
 * @returns {object}
 */
function buildTreeSide(props, keys) {
  const treeSize = pickProp(props, keys.treeSize)
  const ruralOrUrban = pickProp(props, keys.ruralOrUrbanTree)
  const { sizeSquareMetres, area } = treeAreaFields(treeSize)
  return {
    type: treeHabitatTypeFromRuralUrban(ruralOrUrban),
    broadType: INDIVIDUAL_TREES_BROAD_HABITAT,
    condition: stripConditionPrefix(pickProp(props, keys.condition)),
    conditionScore: null,
    distinctiveness: null,
    distinctivenessScore: null,
    strategicSignificance: pickProp(props, keys.strategicSignificance),
    treeSize,
    treeSpecies: pickProp(props, keys.treeType),
    ruralOrUrban,
    sizeSquareMetres,
    area
  }
}

function buildTreeBaselineSubObject(props) {
  return {
    ...buildTreeSide(props, BASELINE_TREE_KEYS),
    retentionCategory: pickProp(props, PROP_KEYS.retentionCategory)
  }
}

function buildTreeProposedSubObject(props) {
  return {
    ...buildTreeSide(props, PROPOSED_TREE_KEYS),
    ...buildAdvanceDelayFields(props)
  }
}

/**
 * Build a post-intervention individual tree. Mirrors the baseline tree shape but
 * splits the attributes into baseline/proposed sub-objects like the other
 * post-intervention features. Top-level `area`/`sizeSquareMetres`/`units` reflect
 * the proposed side, consistent with the area-habitat parcels.
 *
 * @param {object} feature
 */
function buildPostInterventionTree(feature) {
  const { featureId, props } = initParsedFeature(feature)
  const ref = pickProp(props, PROP_KEYS.treeRef)
  const proposed = buildTreeProposedSubObject(props)
  const baseline = buildTreeBaselineSubObject(props)
  const document = {
    featureId,
    ref,
    area: proposed.area,
    sizeSquareMetres: proposed.sizeSquareMetres,
    units: null,
    status: null,
    count: pickProp(props, PROP_KEYS.treeCount),
    baseline,
    proposed,
    properties: props
  }
  document.status = postInterventionAreaStatus(document)
  return {
    document,
    geometryRow: buildGeometryRow(feature, featureId, ref)
  }
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
 * @param {object} trees
 * @param {object} habitatSizes
 * @returns {object}
 */
function embedHabitatSizes(
  habitats,
  hedgerows,
  watercourses,
  trees,
  habitatSizes
) {
  embedParcelSizes(habitats.documents, habitatSizes.areaHabitats)
  embedLinearFeatureSizes(
    hedgerows.documents,
    habitatSizes.hedgerows.individualMetres
  )
  embedLinearFeatureSizes(
    watercourses.documents,
    habitatSizes.watercourses.individualMetres
  )

  // Post-intervention trees carry their urban/rural type on the proposed side;
  // the proposed-side notional area was embedded by buildPostInterventionTree.
  const treeSizes = summarizeTreeSizes(
    trees.documents,
    (tree) => tree.proposed?.type
  )
  return buildHabitatSizesSummary(habitatSizes, treeSizes)
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
 * @param {object[]} [layers.trees]
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
  const trees = splitFeatures(layers.trees ?? [], buildPostInterventionTree)

  const habitatSizesSummary = meta.habitatSizes
    ? embedHabitatSizes(
        habitats,
        hedgerows,
        watercourses,
        trees,
        meta.habitatSizes
      )
    : null

  return buildExtractResult(
    meta,
    { redLine, habitats, hedgerows, watercourses, trees },
    habitatSizesSummary
  )
}
