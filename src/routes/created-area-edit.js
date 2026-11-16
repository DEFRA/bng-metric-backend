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

// A comment belongs to a baseline habitat (BMD-1112) and is editable only on
// the baseline details page, so a post-intervention edit that sends one is
// refused rather than silently answered 200 having saved nothing.
export const postInterventionAreaEditPayload = featureEditPayload
  .fork(['comment'], (schema) => schema.forbidden())
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
  .with('ref', ['broadType', 'habitatType', 'condition'])

export function validateCreatedAreaEdit(feature, edits) {
  if (!Object.hasOwn(edits, 'ref')) {
    return edits
  }
  const reference = editReference(feature)
  if (!reference) {
    throw Boom.badRequest(
      'These attributes can only be edited on Created or Enhanced areas'
    )
  }
  const resolved = resolveStoredTiming(feature, edits)
  validateReferenceAndTiming(resolved)
  if (!areaChoicesValid(resolved, reference, keepableChoices(feature))) {
    throw refusedAreaChoices(feature)
  }
  return resolved
}

// The stored choices an edit may keep unlisted: an Enhanced area's only, and
// never an IGGI habitat type, which neither reference offers and no later
// check refuses (BMD-1045). A Created area chooses from the creation list
// alone, as before.
function keepableChoices(feature) {
  if (resolveRetentionCategory(feature) !== RETENTION_ENHANCED) {
    return {}
  }
  const stored = feature.proposed ?? {}
  return isIggi(stored.type) ? { broadType: stored.broadType } : stored
}

function isIggi(type) {
  return typeof type === 'string' && type.includes('(IGGI)')
}

// The rule an Enhanced area breaks when it sends a choice its baseline's valid
// enhancements do not list, such as from a page loaded before the baseline
// was edited (BMD-1045).
const OFFERED_ENHANCEMENT_RULE = 'offered-enhancement'

// An Enhanced area's choices are refused as an invalid enhancement, so its
// edit form can show the refusal against the target condition; a Created
// area's as a bad request.
function refusedAreaChoices(feature) {
  return resolveRetentionCategory(feature) === RETENTION_ENHANCED
    ? invalidEnhancementError(OFFERED_ENHANCEMENT_RULE)
    : Boom.badRequest('Choose valid area habitat and target condition options')
}

// A Created area chooses from every area habitat it can be created as
// (BMD-1048); an Enhanced one only from the valid enhancements of its
// baseline (BMD-1045), the choices its edit form offers.
function editReference(feature) {
  const category = resolveRetentionCategory(feature)
  if (category === RETENTION_CREATED) {
    return getAreaCreationReference()
  }
  if (category === RETENTION_ENHANCED) {
    return getAreaEnhancementReference(feature.baseline ?? {})
  }
  return null
}

// Each choice must be one the reference offers, unless it keeps the stored
// value along with every choice above it: a broad habitat, a type in it and a
// condition of that type (BMD-1045). A kept choice skips only this
// offered-enhancement check. The recomputed feature is still checked as an
// enhancement (brokenEnhancementRule), so a kept proposal that is no longer a
// valid enhancement of a readable baseline is refused with the library's
// rule. Only a proposal whose baseline the rules cannot read is kept through
// a rename.
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
