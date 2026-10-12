import {
  PROP_KEYS,
  PROPOSED_PROP_KEYS,
  TREE_ADVANCE_DELAY_KEYS,
  pickProp
} from '../properties.js'
import { postInterventionAreaStatus } from '../../../services/post-intervention/calculate-post-intervention-statuses.js'
import {
  INDIVIDUAL_TREES_BROAD_HABITAT,
  treeHabitatTypeFromRuralUrban
} from '../tree-constants.js'
import { treeAreaFields } from '../tree-sizes.js'
import { stripConditionPrefix } from '../../../utilities/enrichment/shared/condition.js'
import {
  copyRetainedProposedFromBaseline,
  RETAINED_TREE_EMPTINESS_FIELDS,
  RETAINED_TREE_PROPOSED_FIELDS
} from '../../../utilities/enrichment/post-intervention/copy-retained-proposed-from-baseline.js'
import {
  buildAdvanceDelayFields,
  emptyHabitatScoreFields,
  retentionCategoryFromProps
} from './extract-post-intervention-sub-objects.js'

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

/**
 * @param {object} props
 * @param {{ treeSize: string[], treeType: string[], ruralOrUrbanTree: string[], condition: string[], strategicSignificance: string[] }} keys
 * @param {unknown} count the point's "Count" column: the number of trees it stands for
 * @returns {object}
 */
function buildTreeSide(props, keys, count) {
  const treeSize = pickProp(props, keys.treeSize)
  const ruralOrUrban = pickProp(props, keys.ruralOrUrbanTree)
  const { sizeSquareMetres, area } = treeAreaFields(treeSize, count)
  return {
    type: treeHabitatTypeFromRuralUrban(ruralOrUrban),
    broadType: INDIVIDUAL_TREES_BROAD_HABITAT,
    condition: stripConditionPrefix(pickProp(props, keys.condition)),
    ...emptyHabitatScoreFields(),
    strategicSignificance: pickProp(props, keys.strategicSignificance),
    treeSize,
    treeSpecies: pickProp(props, keys.treeType),
    ruralOrUrban,
    sizeSquareMetres,
    area
  }
}

function buildTreeBaselineSubObject(props, count) {
  return buildTreeSide(props, BASELINE_TREE_KEYS, count)
}

function buildTreeProposedSubObject(props, count) {
  return {
    ...buildTreeSide(props, PROPOSED_TREE_KEYS, count),
    ...buildAdvanceDelayFields(props, TREE_ADVANCE_DELAY_KEYS)
  }
}

/**
 * @param {object} feature
 * @param {(feature: object) => { featureId: string, props: object, ref: string | null }} initParsedFeature
 * @param {(feature: object, featureId: string, ref: string | null) => object} buildGeometryRow
 * @returns {{ document: object, geometryRow: object }}
 */
export function buildPostInterventionTree(
  feature,
  initParsedFeature,
  buildGeometryRow
) {
  const { featureId, props } = initParsedFeature(feature)
  const ref = pickProp(props, PROP_KEYS.treeRef)
  const count = pickProp(props, PROP_KEYS.treeCount)
  const proposed = buildTreeProposedSubObject(props, count)
  const baseline = buildTreeBaselineSubObject(props, count)
  const document = {
    featureId,
    ref,
    retentionCategory: retentionCategoryFromProps(props),
    area: proposed.area,
    sizeSquareMetres: proposed.sizeSquareMetres,
    units: null,
    status: null,
    count,
    baseline,
    proposed,
    properties: props
  }
  copyRetainedProposedFromBaseline(document, {
    copyFields: RETAINED_TREE_PROPOSED_FIELDS,
    emptinessFields: RETAINED_TREE_EMPTINESS_FIELDS
  })
  document.area = document.proposed.area
  document.sizeSquareMetres = document.proposed.sizeSquareMetres
  document.status = postInterventionAreaStatus(document)
  return {
    document,
    geometryRow: buildGeometryRow(feature, featureId, ref)
  }
}
