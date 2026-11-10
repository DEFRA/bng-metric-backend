import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-library/metric'
import { resolveAdvanceOrDelay } from '../../../utilities/enrichment/post-intervention/proposed-time-difficulty-display.js'

function storedYears(value) {
  return value === MAX_YEARS_PLUS ? MAX_YEARS : value
}

export function proposedAttributes(existing, edits) {
  const advanceYears = storedYears(edits.advanceYears)
  const delayYears = storedYears(edits.delayYears)
  return {
    ...existing,
    type: edits.habitatType,
    condition: edits.condition,
    strategicSignificance:
      edits.strategicSignificance === undefined
        ? (existing?.strategicSignificance ?? null)
        : edits.strategicSignificance,
    strategicSignificanceCategory: null,
    strategicSignificanceScore: null,
    rejectedStrategicSignificance:
      edits.strategicSignificance === undefined
        ? (existing?.rejectedStrategicSignificance ?? null)
        : null,
    advanceYears,
    delayYears,
    advanceYearsIs30Plus: edits.advanceYears === MAX_YEARS_PLUS,
    delayYearsIs30Plus: edits.delayYears === MAX_YEARS_PLUS,
    advanceOrDelay:
      advanceYears != null && delayYears != null
        ? resolveAdvanceOrDelay(advanceYears, delayYears)
        : null
  }
}
