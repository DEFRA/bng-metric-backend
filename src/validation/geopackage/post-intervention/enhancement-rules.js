// Enhancement rules: an enhanced habitat must be a valid enhancement
// of the baseline habitat it enhances. The rules are bng-library's
// (`checkEnhancement`); this reads a post-intervention feature's baseline and
// proposed sides into the labels it takes.
//
// A rule is checked only when it can be: both sides must resolve to a habitat
// and condition the rules know, and the baseline's distinctiveness must have a
// rule. Anything else is left to the checks that own those attributes.

import {
  ENHANCEMENT_KIND,
  checkEnhancement,
  enhancementRulesFor,
  unenhanceableBaseline
} from 'bng-library/metric'

import { engineHabitatTypeCandidates } from '../../../utilities/enrichment/shared/engine-helpers.js'
import { stripConditionPrefix } from '../../../utilities/enrichment/shared/condition.js'
import {
  canonicalHabitatType,
  canonicalHedgerowType,
  canonicalWatercourseType
} from '../../reference/habitat-distinctiveness.js'

/**
 * @param {{ type?: unknown, broadType?: unknown } | undefined} side
 * @returns {string | null} the metric's "<broad> - <type>" label
 */
function areaHabitat(side) {
  for (const type of engineHabitatTypeCandidates(side ?? {})) {
    const habitat = canonicalHabitatType(type)
    if (habitat) {
      return habitat
    }
  }
  return null
}

/**
 * @param {(type: unknown) => string | null} canonicalType
 * @returns {(side: { type?: unknown } | undefined) => string | null}
 */
function linearHabitat(canonicalType) {
  return (side) => canonicalType(side?.type)
}

/**
 * The layers the rules cover, by post-intervention document key. Individual
 * trees are not covered: the rules are for areas, hedgerows and
 * watercourses.
 */
const KIND_BY_LAYER = Object.freeze({
  habitats: { kind: ENHANCEMENT_KIND.area, habitatOf: areaHabitat },
  hedgerows: {
    kind: ENHANCEMENT_KIND.hedgerow,
    habitatOf: linearHabitat(canonicalHedgerowType)
  },
  watercourses: {
    kind: ENHANCEMENT_KIND.watercourse,
    habitatOf: linearHabitat(canonicalWatercourseType)
  }
})

/** The post-intervention layers the enhancement rules are checked on. */
export const ENHANCEMENT_RULE_LAYERS = Object.freeze(Object.keys(KIND_BY_LAYER))

/**
 * @param {string} layer a post-intervention document key
 * @returns {string[]} the ENHANCEMENT_RULE values an enhancement on that layer
 *   can break
 */
export function enhancementRulesForLayer(layer) {
  const kind = KIND_BY_LAYER[layer]?.kind
  return kind ? enhancementRulesFor(kind) : []
}

/**
 * @param {{ habitatOf: (side: object | undefined) => string | null }} layerKind
 * @param {object | undefined} side
 * @returns {EnhancementSide}
 */
function readSide(layerKind, side) {
  return {
    habitat: layerKind.habitatOf(side),
    condition: stripConditionPrefix(side?.condition)
  }
}

/**
 * @typedef {object} EnhancementSide
 * @property {string | null} habitat the metric's label, null if unrecognised
 * @property {unknown} condition prefix stripped
 */

/**
 * One side of an enhancement the library checked. It recognised the habitat
 * and condition, so both are strings.
 *
 * @typedef {object} CheckedSide
 * @property {string} habitat the metric's label
 * @property {string} condition prefix stripped
 * @property {string} distinctiveness
 */

/**
 * @param {EnhancementSide} side a side the library recognised
 * @param {string} distinctiveness
 * @returns {CheckedSide}
 */
function checkedSide(side, distinctiveness) {
  return {
    habitat: side.habitat ?? '',
    condition: typeof side.condition === 'string' ? side.condition : '',
    distinctiveness
  }
}

/**
 * @typedef {object} FeatureEnhancementCheck
 * @property {string} rule one of ENHANCEMENT_RULE
 * @property {boolean} valid
 * @property {CheckedSide} baseline
 * @property {CheckedSide} proposed
 */

/**
 * Check a feature's enhancement against the rule for its baseline.
 *
 * @param {string} layer a post-intervention document key: habitats,
 *   hedgerows or watercourses
 * @param {{ baseline?: object, proposed?: object }} feature
 * @returns {FeatureEnhancementCheck | null} null when no rule can be checked:
 *   bad data (left to the checks that own it) and a baseline out of the rules'
 *   scope are both skipped
 */
export function checkFeatureEnhancement(layer, feature) {
  const layerKind = KIND_BY_LAYER[layer]
  if (!layerKind) {
    return null
  }
  const baseline = readSide(layerKind, feature?.baseline)
  const proposed = readSide(layerKind, feature?.proposed)
  const check = checkEnhancement(layerKind.kind, baseline, proposed)
  if (!check.checked) {
    return null
  }
  return {
    rule: check.rule,
    valid: check.valid,
    baseline: checkedSide(baseline, check.baselineDistinctiveness),
    proposed: checkedSide(proposed, check.proposedDistinctiveness)
  }
}

/**
 * @typedef {object} UnenhanceableFeatureBaseline
 * @property {string} rule one of bng-library's UNENHANCEABLE_BASELINE
 * @property {boolean} mvsOnly
 * @property {CheckedSide} baseline
 */

/**
 * The layers checked for a baseline that cannot be enhanced. Individual trees
 * are area habitats there (a Rural or Urban tree is a Medium habitat), though
 * the enhancement rules do not cover them.
 */
const BASELINE_KIND_BY_LAYER = Object.freeze({
  ...KIND_BY_LAYER,
  trees: { kind: ENHANCEMENT_KIND.area, habitatOf: areaHabitat }
})

/** The post-intervention layers checked for a baseline that cannot be enhanced. */
export const UNENHANCEABLE_BASELINE_LAYERS = Object.freeze(
  Object.keys(BASELINE_KIND_BY_LAYER)
)

/**
 * Whether a baseline is one the service cannot enhance at all (BMD-1182),
 * whatever it is enhanced into. The rules are bng-library's
 * (`unenhanceableBaseline`).
 *
 * @param {string} layer a post-intervention document key: habitats,
 *   hedgerows, watercourses or trees
 * @param {{ type?: unknown, broadType?: unknown, condition?: unknown } | undefined} side
 *   the baseline habitat: a post-intervention feature's `baseline` side, or a
 *   baseline document feature
 * @returns {UnenhanceableFeatureBaseline | null} null when the baseline can be
 *   enhanced, or its habitat is not one the metric knows (left to the checks
 *   that own it)
 */
export function checkBaselineEnhanceable(layer, side) {
  const layerKind = BASELINE_KIND_BY_LAYER[layer]
  if (!layerKind) {
    return null
  }
  const baseline = readSide(layerKind, side)
  const match = unenhanceableBaseline(layerKind.kind, baseline)
  if (!match) {
    return null
  }
  return {
    rule: match.rule,
    mvsOnly: match.mvsOnly,
    baseline: checkedSide(baseline, match.distinctiveness)
  }
}
