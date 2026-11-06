import {
  resolveRetentionCategory,
  RETENTION_CREATED
} from '../utilities/enrichment/post-intervention/retention-category.js'
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

export function createdLinearEditPayload(reference, extra = {}) {
  return Joi.object({
    ref: featureEditPayload.extract('ref').required(),
    habitatType: featureEditPayload.extract('habitatType').optional(),
    condition: featureEditPayload.extract('condition').optional(),
    strategicSignificance: Joi.string()
      .valid(...reference.strategicSignificance.map((s) => s.value))
      .allow(null, '')
      .optional(),
    advanceYears: createdEditYears.optional(),
    delayYears: createdEditYears.optional(),
    ...extra
  })
}

function resolveCreatedLinearCondition(feature, edits) {
  if (edits.condition !== undefined) {
    return edits.condition
  }
  if ((edits.habitatType ?? null) !== (feature.proposed?.type ?? null)) {
    throw Boom.badRequest(
      'Choose a target condition for the selected habitat type'
    )
  }
  return feature.proposed?.condition ?? null
}

export function validateCreatedLinearEdit(feature, edits, reference, label) {
  if (resolveRetentionCategory(feature) !== RETENTION_CREATED) {
    throw Boom.badRequest(
      `These attributes can only be edited on Created ${label}s`
    )
  }
  const withType = {
    ...edits,
    habitatType:
      edits.habitatType === undefined
        ? (feature.proposed?.type ?? null)
        : edits.habitatType
  }
  const resolved = {
    ...resolveStoredTiming(feature, withType),
    condition: resolveCreatedLinearCondition(feature, withType)
  }
  validateReferenceAndTiming(resolved)
  const type = reference.habitatTypes.find(
    (t) => t.name === resolved.habitatType
  )
  if (
    (edits.habitatType && !type) ||
    (edits.condition &&
      !type?.conditions.some((c) => c.condition === edits.condition))
  ) {
    throw Boom.badRequest(
      `Choose valid ${label} habitat and target condition options`
    )
  }
  return resolved
}
