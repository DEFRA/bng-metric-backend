import Boom from '@hapi/boom'
import Joi from 'joi'
import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-library/metric'
import { featureEditPayload } from './shared-params.js'

export const createdEditYears = Joi.alternatives()
  .try(Joi.number().integer().min(0).max(MAX_YEARS), Joi.valid(MAX_YEARS_PLUS))
  .allow(null)

export function validateReferenceAndTiming(edits) {
  const { error } = featureEditPayload
    .extract('ref')
    .required()
    .label('ref')
    .validate(edits.ref)
  if (error) {
    throw Boom.badRequest(error.message)
  }
  if (
    Number.parseFloat(edits.advanceYears) > 0 &&
    Number.parseFloat(edits.delayYears) > 0
  ) {
    throw Boom.badRequest(
      'Enter either advance or delay greater than zero, not both'
    )
  }
}

export function resolveStoredTiming(feature, edits) {
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
