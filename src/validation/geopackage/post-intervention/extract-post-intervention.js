import { randomUUID } from 'node:crypto'

import { normaliseEncroachmentLabel } from 'bng-library/metric'

import {
  BASELINE_STRATEGIC_SIGNIFICANCE,
  PROP_KEYS,
  PROPOSED_PROP_KEYS,
  pickProp
} from '../properties.js'
import { commentForPostIntervention } from '../comment-check.js'
import { cleanHabitatRef } from '../habitat-ref-check.js'
import {
  postInterventionAreaStatus,
  postInterventionHedgerowStatus,
  postInterventionWatercourseStatus
} from '../../../services/post-intervention/calculate-post-intervention-statuses.js'
import {
  splitFeatures,
  embedPostInterventionHabitatSizes,
  buildExtractResult,
  verticalAreaFields
} from '../extract-shared.js'
import { stripConditionPrefix } from '../../../utilities/enrichment/shared/condition.js'
import { isLostRetentionCategory } from '../../../utilities/enrichment/post-intervention/retention-category.js'
import {
  copyRetainedProposedFromBaseline,
  RETAINED_AREA_PROPOSED_FIELDS,
  RETAINED_HEDGEROW_PROPOSED_FIELDS,
  RETAINED_WATERCOURSE_PROPOSED_FIELDS
} from '../../../utilities/enrichment/post-intervention/copy-retained-proposed-from-baseline.js'
import {
  buildAdvanceDelayFields,
  buildAreaBaselineSubObject,
  buildAreaProposedSubObject,
  buildLinearBaselineSubObject,
  buildLinearProposedSubObject,
  emptyHabitatScoreFields,
  retentionCategoryFromProps
} from './extract-post-intervention-sub-objects.js'
import { buildPostInterventionTree } from './extract-post-intervention-trees.js'
import { irreplaceableField } from '../irreplaceable.js'

/**
 * The ref is the Parcel Ref as stored: trimmed and truncated
 * (cleanHabitatRef). Trees read their own Tree Ref instead.
 *
 * @param {object} feature
 * @returns {{ featureId: string, props: object, ref: string | null }}
 */
function initParsedFeature(feature) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  return {
    featureId,
    props,
    ref: cleanHabitatRef(pickProp(props, PROP_KEYS.parcelRef))
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
    geometryJson: feature.geometryJson,
    srid: feature.nativeSrid
  }
}

/**
 * @param {object} document
 * @param {readonly string[] | undefined} copyFields
 */
function applyRetainedProposedCopy(document, copyFields) {
  if (copyFields) {
    copyRetainedProposedFromBaseline(document, { copyFields })
  }
}

function buildPostInterventionFeature(
  feature,
  buildDocument,
  statusFn,
  copyFields
) {
  const { featureId, props, ref } = initParsedFeature(feature)
  const document = buildDocument(featureId, ref, props)
  applyRetainedProposedCopy(document, copyFields)
  document.status = statusFn(document)
  return {
    document,
    geometryRow: buildGeometryRow(feature, featureId, ref)
  }
}

function buildPostInterventionHabitat(feature, template) {
  return buildPostInterventionFeature(
    feature,
    (featureId, ref, props) => ({
      featureId,
      ref,
      retentionCategory: retentionCategoryFromProps(props),
      comment: commentForPostIntervention(props, { template }),
      ...irreplaceableField(props),
      area: null,
      sizeSquareMetres: null,
      units: null,
      status: null,
      baseline: buildAreaBaselineSubObject(props),
      proposed: buildAreaProposedSubObject(props),
      properties: props
    }),
    postInterventionAreaStatus,
    RETAINED_AREA_PROPOSED_FIELDS
  )
}

/**
 * A post-intervention vertical area habitat: an area habitat sized by the
 * Area its row gives, in hectares, stored in square metres, which may differ
 * from its parent's
 * when part of a structure is kept.
 */
function buildPostInterventionVerticalHabitat(feature, template) {
  const built = buildPostInterventionHabitat(feature, template)
  Object.assign(built.document, verticalAreaFields(feature.properties))
  return built
}

function buildPostInterventionHedgerow(feature, template) {
  return buildPostInterventionFeature(
    feature,
    (featureId, ref, props) => ({
      featureId,
      ref,
      retentionCategory: retentionCategoryFromProps(props),
      comment: commentForPostIntervention(props, { template }),
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
    postInterventionHedgerowStatus,
    RETAINED_HEDGEROW_PROPOSED_FIELDS
  )
}

function normaliseEncroachmentField(value) {
  if (typeof value === 'string') {
    return normaliseEncroachmentLabel(value)
  }
  return value
}

function buildWatercourseEncroachmentFields(
  props,
  riparianKey,
  watercourseKey
) {
  return {
    riparianEncroachment: normaliseEncroachmentField(
      pickProp(props, riparianKey)
    ),
    watercourseEncroachment: normaliseEncroachmentField(
      pickProp(props, watercourseKey)
    )
  }
}

function buildPostInterventionWatercourse(feature, template) {
  return buildPostInterventionFeature(
    feature,
    (featureId, ref, props) => {
      const baselineEncroachments = buildWatercourseEncroachmentFields(
        props,
        PROP_KEYS.riparianEncroachment,
        PROP_KEYS.watercourseEncroachment
      )
      const proposedEncroachments = buildWatercourseEncroachmentFields(
        props,
        PROPOSED_PROP_KEYS.riparianEncroachment,
        PROPOSED_PROP_KEYS.watercourseEncroachment
      )

      return {
        featureId,
        ref,
        retentionCategory: retentionCategoryFromProps(props),
        comment: commentForPostIntervention(props, { template }),
        length: null,
        sizeMetres: null,
        units: null,
        status: null,
        baseline: {
          type: pickProp(props, PROP_KEYS.riverType),
          condition: stripConditionPrefix(pickProp(props, PROP_KEYS.condition)),
          ...emptyHabitatScoreFields(),
          ...baselineEncroachments,
          strategicSignificance: BASELINE_STRATEGIC_SIGNIFICANCE
        },
        proposed: {
          type: pickProp(props, PROPOSED_PROP_KEYS.riverType),
          condition: stripConditionPrefix(
            pickProp(props, PROPOSED_PROP_KEYS.condition)
          ),
          ...emptyHabitatScoreFields(),
          ...buildAdvanceDelayFields(props),
          ...proposedEncroachments,
          strategicSignificance: pickProp(
            props,
            PROPOSED_PROP_KEYS.strategicSignificance
          )
        },
        properties: props
      }
    },
    postInterventionWatercourseStatus,
    RETAINED_WATERCOURSE_PROPOSED_FIELDS
  )
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
        geometryJson: feature.geometryJson,
        srid: feature.nativeSrid
      }
    }
  }
  return { document: null, geometryRow: null }
}

/**
 * @param {object} feature
 * @returns {boolean}
 */
function isKeptPostInterventionFeature(feature) {
  const props = feature.properties ?? {}
  const category = pickProp(props, PROP_KEYS.retentionCategory)
  return isLostRetentionCategory(category) === false
}

/**
 * Drop features whose GPKG Retention Category is Lost (hedgerows, watercourses,
 * trees and vertical area habitats). Area habitats with Lost are kept and
 * mapped to Created later.
 *
 * @param {object[]} features
 * @returns {object[]}
 */
function excludeLostRetentionFeatures(features) {
  return (features ?? []).filter(isKeptPostInterventionFeature)
}

/**
 * @param {object} layers
 * @returns {object}
 */
export function filterLostPostInterventionLayers(layers) {
  return {
    ...layers,
    hedgerows: excludeLostRetentionFeatures(layers.hedgerows),
    watercourses: excludeLostRetentionFeatures(layers.watercourses),
    trees: excludeLostRetentionFeatures(layers.trees),
    verticalHabitats: excludeLostRetentionFeatures(layers.verticalHabitats)
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
 * @param {object[]} [layers.verticalHabitats]
 * @param {object} [meta]
 * @param {string} [meta.uploadId]
 * @param {string} [meta.filename]
 * @param {number} [meta.fileSize]
 * @param {string} [meta.importedAt] ISO timestamp; defaults to now
 * @param {object} [meta.habitatSizes] pre-calculated habitat sizes from calculateHabitatSizes
 * @returns {{ document: object, geometries: object }}
 */
export function extractPostIntervention(layers, meta = {}) {
  const filteredLayers = filterLostPostInterventionLayers(layers)
  const redLine = buildRedLine(filteredLayers.redline)
  const template = Boolean(meta.template)
  const habitats = splitFeatures(
    filteredLayers.areas ?? [],
    buildPostInterventionHabitat,
    template
  )
  const hedgerows = splitFeatures(
    filteredLayers.hedgerows ?? [],
    buildPostInterventionHedgerow,
    template
  )
  const watercourses = splitFeatures(
    filteredLayers.watercourses ?? [],
    buildPostInterventionWatercourse,
    template
  )
  const trees = splitFeatures(filteredLayers.trees ?? [], (feature) =>
    buildPostInterventionTree(
      feature,
      initParsedFeature,
      buildGeometryRow,
      template
    )
  )
  const verticalHabitats = splitFeatures(
    filteredLayers.verticalHabitats ?? [],
    buildPostInterventionVerticalHabitat,
    template
  )

  const habitatSizesSummary = meta.habitatSizes
    ? embedPostInterventionHabitatSizes(
        { habitats, hedgerows, watercourses, trees, verticalHabitats },
        meta.habitatSizes
      )
    : null

  return buildExtractResult(
    meta,
    { redLine, habitats, hedgerows, watercourses, trees, verticalHabitats },
    habitatSizesSummary
  )
}
