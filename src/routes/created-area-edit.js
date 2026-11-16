import Boom from '@hapi/boom'
import Joi from 'joi'
import { featureEditPayload } from './shared-params.js'
import {
  createdEditYears,
  resolveStoredTiming,
  validateReferenceAndTiming
} from './created-feature-edit.js'
import { getAreaCreationReference } from '../validation/reference/area-creation.js'
import { getAreaEnhancementReference } from '../validation/reference/area-enhancement.js'
import { invalidEnhancementError } from './invalid-enhancement-error.js'
import {
  resolveRetentionCategory,
  RETENTION_CREATED,
  RETENTION_ENHANCED
} from '../utilities/enrichment/post-intervention/retention-category.js'

// A comment belongs to a baseline habitat (BMD-1112) and is editable only on
// the baseline details page, so a post-intervention edit that sends one is
// refused rather than silently answered 200 having saved nothing.
export const postInterventionAreaEditPayload = featureEditPayload
  .fork(['comment'], (schema) => schema.forbidden())
  .keys({
    strategicSignificance: Joi.string()
      .valid(
        ...getAreaCreationReference().strategicSignificance.map((s) => s.value)
      )
      .allow(null, '')
      .optional(),
    advanceYears: createdEditYears.optional(),
    delayYears: createdEditYears.optional()
  })
  .with('strategicSignificance', 'ref')
  .with('advanceYears', 'ref')
  .with('delayYears', 'ref')
  .with('ref', ['broadType', 'habitatType', 'condition'])

export function validateCreatedAreaEdit(feature, edits) {
  if (!Object.hasOwn(edits, 'ref')) {
    return edits
  }
  const reference = editReference(feature)
  if (!reference) {
    throw Boom.badRequest(
      'These attributes can only be edited on Created or Enhanced areas'
    )
  }
  const resolved = resolveStoredTiming(feature, edits)
  validateReferenceAndTiming(resolved)
  if (!areaChoicesValid(resolved, reference, feature.proposed ?? {})) {
    throw refusedAreaChoices(feature)
  }
  return resolved
}

// The rule an Enhanced area breaks when it sends a choice its baseline's valid
// enhancements do not list, such as from a page loaded before the baseline
// was edited (BMD-1045).
const OFFERED_ENHANCEMENT_RULE = 'offered-enhancement'

// An Enhanced area's choices are refused as an invalid enhancement, so its
// edit form can show the refusal against the target condition; a Created
// area's as a bad request.
function refusedAreaChoices(feature) {
  return resolveRetentionCategory(feature) === RETENTION_ENHANCED
    ? invalidEnhancementError(OFFERED_ENHANCEMENT_RULE)
    : Boom.badRequest('Choose valid area habitat and target condition options')
}

// A Created area chooses from every area habitat it can be created as
// (BMD-1048); an Enhanced one only from the valid enhancements of its
// baseline (BMD-1045), the choices its edit form offers.
function editReference(feature) {
  const category = resolveRetentionCategory(feature)
  if (category === RETENTION_CREATED) {
    return getAreaCreationReference()
  }
  if (category === RETENTION_ENHANCED) {
    return getAreaEnhancementReference(feature.baseline ?? {})
  }
  return null
}

// Each choice must be one the reference offers, unless it keeps the stored
// value along with every choice above it: a broad habitat, a type in it and a
// condition of that type. An Enhanced area saved before its baseline changed,
// or whose baseline the rules cannot read, keeps a proposal its edit form does
// not list, and renaming it must not refuse or clear that proposal (BMD-1045).
// The whole feature is still checked as an enhancement once recomputed
// (brokenEnhancementRule).
function areaChoicesValid(edits, reference, stored) {
  const keepsBroad = keeps(edits.broadType, stored.broadType)
  const keepsType = keepsBroad && keeps(edits.habitatType, stored.type)
  const keepsCondition = keepsType && keeps(edits.condition, stored.condition)
  const type = reference.habitatTypes.find(
    (t) => t.broad === edits.broadType && t.name === edits.habitatType
  )
  const validBroad =
    !edits.broadType ||
    keepsBroad ||
    reference.habitatTypes.some((t) => t.broad === edits.broadType)
  const validType = !edits.habitatType || keepsType || Boolean(type)
  const validCondition =
    !edits.condition ||
    keepsCondition ||
    Boolean(type?.conditions.some((c) => c.condition === edits.condition))
  return validBroad && validType && validCondition
}

function keeps(value, stored) {
  return Boolean(value) && value === stored
}
