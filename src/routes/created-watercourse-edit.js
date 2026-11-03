import Joi from 'joi'
import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-library/metric'
import {
  createdLinearEditPayload,
  validateCreatedLinearEdit
} from './created-feature-edit.js'
import { getWatercourseCreationReference } from '../validation/reference/watercourse-creation.js'

const reference = getWatercourseCreationReference()
const encroachmentFields = ['watercourseEncroachment', 'riparianEncroachment']

export const postInterventionWatercourseEditPayload = createdLinearEditPayload(
  reference,
  Object.fromEntries(
    encroachmentFields.map((field) => [
      field,
      Joi.string()
        .valid(...reference[field])
        .allow(null, '')
        .optional()
    ])
  )
)

function withSavedAdvance(feature, edits) {
  if (
    edits.advanceYears !== undefined ||
    !Object.hasOwn(feature, 'editedAdvanceYears')
  ) {
    return edits
  }
  const saved = feature.editedAdvanceYears
  return {
    ...edits,
    advanceYears:
      saved === MAX_YEARS && feature.proposed?.advanceYearsIs30Plus
        ? MAX_YEARS_PLUS
        : saved
  }
}

export function validateCreatedWatercourseEdit(feature, edits) {
  const resolved = validateCreatedLinearEdit(
    feature,
    withSavedAdvance(feature, edits),
    reference,
    'watercourse'
  )
  // As with timing and condition, omission preserves an imported value under
  // the row lock, while explicit null clears it. New values are schema-checked.
  for (const field of encroachmentFields) {
    if (edits[field] === undefined) {
      resolved[field] = feature.proposed?.[field] ?? null
    }
  }
  return resolved
}
