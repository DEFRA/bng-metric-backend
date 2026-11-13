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
  validateAreaChoices(resolved, reference)
  return resolved
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

function validateAreaChoices(edits, reference) {
  const type = reference.habitatTypes.find(
    (t) => t.broad === edits.broadType && t.name === edits.habitatType
  )
  const invalidBroad =
    edits.broadType &&
    !reference.habitatTypes.some((t) => t.broad === edits.broadType)
  const invalidType = edits.habitatType && !type
  const invalidCondition =
    edits.condition &&
    !type?.conditions.some((c) => c.condition === edits.condition)
  if (invalidBroad || invalidType || invalidCondition) {
    throw Boom.badRequest(
      'Choose valid area habitat and target condition options'
    )
  }
}
