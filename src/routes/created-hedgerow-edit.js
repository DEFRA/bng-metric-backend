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
      postInterventionAreaEditPayload.extract(field).required()
    ])
  )
)

export function validateCreatedHedgerowEdit(feature, edits) {
  if (resolveRetentionCategory(feature) !== RETENTION_CREATED) {
    throw Boom.badRequest(
      'These attributes can only be edited on Created hedgerows'
    )
  }
  validateReferenceAndTiming(edits)
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
}
