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
import { invalidEnhancementError } from './invalid-enhancement-error.js'
import {
  resolveRetentionCategory,
  RETENTION_CREATED,
  RETENTION_ENHANCED
} from '../utilities/enrichment/post-intervention/retention-category.js'

// A Created or Enhanced habitat's comment is its supporting information
// (BMD-1153, BMD-1190). It is saved with the complete post-intervention edit
// only, so a comment without `ref` is refused rather than answered 200 having
// saved nothing.
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
  .with('strategicSignificance', 'ref')
  .with('advanceYears', 'ref')
  .with('delayYears', 'ref')
  .with('comment', 'ref')
  .with('ref', ['broadType', 'habitatType', 'condition'])

// A Created or an Enhanced area habitat's edit (BMD-1048, BMD-1045), named as
// validatePostInterventionTreeEdit is for trees.
export function validatePostInterventionAreaEdit(feature, edits) {
  if (!Object.hasOwn(edits, 'ref')) {
    return edits
  }
  const enhanced = resolveRetentionCategory(feature) === RETENTION_ENHANCED
  const reference = editReference(feature, enhanced)
  if (!reference) {
    throw Boom.badRequest(
      'These attributes can only be edited on Created or Enhanced areas'
    )
  }
  const resolved = resolveStoredTiming(feature, edits)
  validateReferenceAndTiming(resolved)
  const keepable = enhanced ? (feature.proposed ?? {}) : {}
  if (!areaChoicesValid(resolved, reference, keepable)) {
    throw refusedAreaChoices(enhanced)
  }
  return resolved
}

// The rule an Enhanced area breaks when it sends a choice its baseline's valid
// enhancements do not list, such as from a page loaded before the baseline
// was edited (BMD-1045).
const OFFERED_ENHANCEMENT_RULE = 'offered-enhancement'

// An Enhanced area's choices are refused as an invalid enhancement, so its
// edit form can show the refusal against the target condition; a Created
// area's as a bad request.
function refusedAreaChoices(enhanced) {
  return enhanced
    ? invalidEnhancementError(OFFERED_ENHANCEMENT_RULE)
    : Boom.badRequest('Choose valid area habitat and target condition options')
}

// A Created area chooses from every area habitat it can be created as
// (BMD-1048); an Enhanced one only from the valid enhancements of its
// baseline (BMD-1045), the choices its edit form offers.
function editReference(feature, enhanced) {
  if (enhanced) {
    return getAreaEnhancementReference(feature.baseline ?? {})
  }
  return resolveRetentionCategory(feature) === RETENTION_CREATED
    ? getAreaCreationReference()
    : null
}

// Only an Enhanced area may keep a stored choice unlisted; a Created area
// chooses from the creation list alone, as before. An unchanged IGGI proposal
// is kept like any other: neither list offers an IGGI type, so one can only
// be kept, never newly chosen, and the library accepts some IGGI
// enhancements, which brokenEnhancementRule still checks.
//
// Each choice must be one the reference offers, unless it keeps the stored
// value along with every choice above it: a broad habitat, a type in it and a
// condition of that type (BMD-1045). A kept choice skips only this
// offered-enhancement check. The recomputed feature is still checked as an
// enhancement (brokenEnhancementRule), so a kept proposal that is no longer a
// valid enhancement of a readable baseline is refused with the library's
// rule. So a rename keeps only a proposal the lists cannot offer but the
// library accepts, such as an IGGI one, or one whose baseline the rules
// cannot read.
function areaChoicesValid(edits, reference, stored) {
  const kept = keptChoices(edits, stored)
  const type = reference.habitatTypes.find(
    (t) => t.broad === edits.broadType && t.name === edits.habitatType
  )
  return (
    choiceValid(edits.broadType, kept.broad, () =>
      reference.habitatTypes.some((t) => t.broad === edits.broadType)
    ) &&
    choiceValid(edits.habitatType, kept.type, () => Boolean(type)) &&
    choiceValid(edits.condition, kept.condition, () =>
      Boolean(type?.conditions.some((c) => c.condition === edits.condition))
    )
  )
}

// Which choices keep their stored value along with every choice above them.
function keptChoices(edits, stored) {
  const broad = keeps(edits.broadType, stored.broadType)
  const type = broad && keeps(edits.habitatType, stored.type)
  return {
    broad,
    type,
    condition: type && keeps(edits.condition, stored.condition)
  }
}

// A blank choice and a kept one are valid; any other must be offered.
function choiceValid(value, kept, offered) {
  return !value || kept || offered()
}

function keeps(value, stored) {
  return Boolean(value) && value === stored
}
