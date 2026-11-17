import {
  resolveRetentionCategory,
  RETENTION_CREATED,
  RETENTION_ENHANCED
} from '../utilities/enrichment/post-intervention/retention-category.js'
import Boom from '@hapi/boom'
import Joi from 'joi'
import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-library/metric'
import { featureEditPayload } from './shared-params.js'
import { featureNotEditableError } from './feature-not-editable-error.js'
import {
  invalidEnhancementError,
  OFFERED_ENHANCEMENT_RULE
} from './invalid-enhancement-error.js'

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
    // Supporting information (BMD-1153); leaving it out keeps the stored one.
    comment: featureEditPayload.extract('comment'),
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

/**
 * Check a Created linear feature's edit against `reference`, or, with
 * `enhancedReference`, an Enhanced one's against the valid enhancements of its
 * baseline (BMD-1046). An omitted habitat type or condition keeps the stored
 * one, unchecked; a sent one must be offered, except that an Enhanced
 * feature may send back its stored habitat type, and its stored condition
 * under that type, unlisted, as an Enhanced area may (BMD-1045). The
 * recomputed feature is still checked as an enhancement
 * (brokenEnhancementRule). An Enhanced feature's refused choice is an
 * invalid enhancement (422), so its edit form can show it against the target
 * condition; a Created one's is a bad request.
 *
 * @param {object} feature
 * @param {object} edits
 * @param {object} reference the creation reference
 * @param {string} label
 * @param {{ enhancedReference?: (feature: object) => object }} [options]
 * @returns {object} the edits, with omitted values resolved
 */
export function validateCreatedLinearEdit(
  feature,
  edits,
  reference,
  label,
  { enhancedReference } = {}
) {
  const enhanced = isEditableEnhanced(feature, enhancedReference)
  assertLinearEditable(feature, edits, { enhanced, label })
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
  const choices = enhanced ? enhancedReference(feature) : reference
  const kept = keptLinearChoices(
    edits,
    enhanced ? (feature.proposed ?? {}) : {}
  )
  if (!linearChoicesOffered(choices, resolved, edits, kept)) {
    throw refusedLinearChoices(enhanced, label)
  }
  return resolved
}

// Only a Created feature, or an Enhanced one its kind lets be edited, takes
// the complete edit. A Created feature's comment is its supporting
// information (BMD-1153); an Enhanced one's is not editable yet (BMD-1190),
// as for areas and trees.
function assertLinearEditable(feature, edits, { enhanced, label }) {
  if (!enhanced && resolveRetentionCategory(feature) !== RETENTION_CREATED) {
    throw Boom.badRequest(
      `These attributes can only be edited on Created ${label}s`
    )
  }
  if (enhanced && Object.hasOwn(edits, 'comment')) {
    throw featureNotEditableError(
      `Supporting information can be edited on a Created ${label} only`
    )
  }
}

function isEditableEnhanced(feature, enhancedReference) {
  return (
    Boolean(enhancedReference) &&
    resolveRetentionCategory(feature) === RETENTION_ENHANCED
  )
}

// Which sent choices keep the stored ones: the habitat type, omitted or sent
// as stored, and the condition, sent as stored under a kept type.
function keptLinearChoices(edits, stored) {
  const type =
    edits.habitatType === undefined ||
    (Boolean(edits.habitatType) && edits.habitatType === stored.type)
  return {
    type,
    condition:
      type && Boolean(edits.condition) && edits.condition === stored.condition
  }
}

// A blank or kept choice is valid; any other sent one must be offered.
function linearChoicesOffered(choices, resolved, edits, kept) {
  const type = choices.habitatTypes.find((t) => t.name === resolved.habitatType)
  const typeOffered = !edits.habitatType || kept.type || Boolean(type)
  const conditionOffered =
    !edits.condition ||
    kept.condition ||
    Boolean(type?.conditions.some((c) => c.condition === edits.condition))
  return typeOffered && conditionOffered
}

function refusedLinearChoices(enhanced, label) {
  return enhanced
    ? invalidEnhancementError(OFFERED_ENHANCEMENT_RULE)
    : Boom.badRequest(
        `Choose valid ${label} habitat and target condition options`
      )
}
