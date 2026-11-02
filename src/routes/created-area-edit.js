import Boom from '@hapi/boom'
import Joi from 'joi'
import { featureEditPayload } from './shared-params.js'
import {
  createdEditYears,
  validateReferenceAndTiming
} from './created-feature-edit.js'
import { getAreaCreationReference } from '../validation/reference/area-creation.js'
import {
  resolveRetentionCategory,
  RETENTION_CREATED
} from '../utilities/enrichment/post-intervention/retention-category.js'

export const postInterventionAreaEditPayload = featureEditPayload
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
  .and('ref', 'strategicSignificance', 'advanceYears', 'delayYears')
  .with('ref', ['broadType', 'habitatType', 'condition'])

export function validateCreatedAreaEdit(feature, edits) {
  if (!Object.hasOwn(edits, 'ref')) {
    return
  }
  if (resolveRetentionCategory(feature) !== RETENTION_CREATED) {
    throw Boom.badRequest(
      'These attributes can only be edited on Created areas'
    )
  }
  validateReferenceAndTiming(edits)
  validateAreaChoices(edits)
}

function validateAreaChoices(edits) {
  const reference = getAreaCreationReference()
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
