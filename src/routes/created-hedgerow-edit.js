import { MAX_YEARS } from 'bng-library/metric'
import Boom from '@hapi/boom'
import Joi from 'joi'
import {
  postInterventionAreaEditPayload,
  validateReferenceAndTiming
} from './created-area-edit.js'
import { getHedgerowCreationReference } from '../validation/reference/hedgerow-creation.js'
import {
  resolveRetentionCategory,
  RETENTION_CREATED
} from '../utilities/enrichment/post-intervention/retention-category.js'

const fields = [
  'ref',
  'habitatType',
  'condition',
  'strategicSignificance',
  'advanceYears',
  'delayYears'
]
export const postInterventionHedgerowEditPayload = Joi.object(
  Object.fromEntries(
    fields.map((field) => [
      field,
      ['advanceYears', 'delayYears'].includes(field)
        ? postInterventionAreaEditPayload.extract(field).optional()
        : postInterventionAreaEditPayload.extract(field).required()
    ])
  )
)

function resolveStoredTiming(feature, edits) {
  // Omission means keep the stored value; null is an explicit clear. Resolve
  // under the project row lock so a stale form cannot restore an older value.
  const resolved = { ...edits }
  for (const field of ['advanceYears', 'delayYears']) {
    if (edits[field] === undefined) {
      const saved = feature.proposed?.[field] ?? null
      resolved[field] =
        saved === MAX_YEARS && feature.proposed?.[`${field}Is30Plus`]
          ? '30+'
          : saved
    }
  }
  return resolved
}

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
