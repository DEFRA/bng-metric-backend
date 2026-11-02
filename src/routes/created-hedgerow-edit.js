import Boom from '@hapi/boom'
import Joi from 'joi'
import {
  createdEditYears,
  resolveStoredTiming,
  validateReferenceAndTiming
} from './created-feature-edit.js'
import { featureEditPayload } from './shared-params.js'
import { getHedgerowCreationReference } from '../validation/reference/hedgerow-creation.js'
import {
  resolveRetentionCategory,
  RETENTION_CREATED
} from '../utilities/enrichment/post-intervention/retention-category.js'

export const postInterventionHedgerowEditPayload = Joi.object({
  ref: featureEditPayload.extract('ref').required(),
  habitatType: featureEditPayload.extract('habitatType').required(),
  condition: featureEditPayload.extract('condition').required(),
  strategicSignificance: Joi.string()
    .valid(
      ...getHedgerowCreationReference().strategicSignificance.map(
        (s) => s.value
      )
    )
    .allow(null, '')
    .required(),
  advanceYears: createdEditYears.optional(),
  delayYears: createdEditYears.optional()
})

export function validateCreatedHedgerowEdit(feature, edits) {
  if (resolveRetentionCategory(feature) !== RETENTION_CREATED) {
    throw Boom.badRequest(
      'These attributes can only be edited on Created hedgerows'
    )
  }
  const resolved = resolveStoredTiming(feature, edits)
  validateReferenceAndTiming(resolved)
  const type = getHedgerowCreationReference().habitatTypes.find(
    (t) => t.name === edits.habitatType
  )
  if (
    (edits.habitatType && !type) ||
    (edits.condition &&
      !type?.conditions.some((c) => c.condition === edits.condition))
  ) {
    throw Boom.badRequest(
      'Choose valid hedgerow habitat and target condition options'
    )
  }
  return resolved
}
