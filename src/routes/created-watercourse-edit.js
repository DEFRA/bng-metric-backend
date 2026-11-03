import Joi from 'joi'
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

export function validateCreatedWatercourseEdit(feature, edits) {
  const resolved = validateCreatedLinearEdit(
    feature,
    edits,
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
