import Joi from 'joi'
import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-library/metric'
import {
  createdLinearEditPayload,
  validateCreatedLinearEdit
} from './created-feature-edit.js'
import { getWatercourseCreationReference } from '../validation/reference/watercourse-creation.js'
import { getWatercourseEnhancementReference } from '../validation/reference/watercourse-enhancement.js'
import { restoreUploadedWatercourseAdvance } from '../utilities/enrichment/post-intervention/lineage-outcomes.js'

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

function storedAdvanceInput(feature) {
  if (Object.hasOwn(feature, 'editedAdvanceYears')) {
    return feature.editedAdvanceYears
  }
  if (feature.proposed?.advanceYears != null) {
    return undefined
  }
  // Reuse import restoration and its parent/type eligibility rules without
  // changing the stored row or replacing a non-null current input.
  const restored = { ...feature, proposed: { ...feature.proposed } }
  restoreUploadedWatercourseAdvance({ watercourses: [restored] })
  return restored.proposed.advanceYears
}

function withSavedAdvance(feature, edits) {
  if (edits.advanceYears !== undefined) {
    return edits
  }
  // A positive delay replaces an advance hidden by lineage. Visible or
  // explicitly submitted advances still take part in mutual-exclusion checks.
  if (
    feature.proposed?.advanceYears == null &&
    Number.parseFloat(edits.delayYears) > 0
  ) {
    return { ...edits, advanceYears: null }
  }
  const saved = storedAdvanceInput(feature)
  if (saved === undefined) {
    return edits
  }
  return {
    ...edits,
    advanceYears:
      saved === MAX_YEARS && feature.proposed?.advanceYearsIs30Plus
        ? MAX_YEARS_PLUS
        : saved
  }
}

// A Created watercourse's edit (BMD-1050), or an Enhanced one's, within the
// valid enhancements of its baseline (BMD-1047). Its encroachments are not
// restricted by the enhancement rules, so both offer the same lists.
export function validateCreatedWatercourseEdit(feature, edits) {
  const resolved = validateCreatedLinearEdit(
    feature,
    withSavedAdvance(feature, edits),
    reference,
    'watercourse',
    {
      enhancedReference: (enhanced) =>
        getWatercourseEnhancementReference(enhanced.baseline ?? {})
    }
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
