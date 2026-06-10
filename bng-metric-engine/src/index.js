export {
  CONDITION_SCORES,
  DIFFICULTY_MULTIPLIER,
  DISTINCTIVENESS_CATEGORIES,
  DISTINCTIVENESS_SCORES,
  HABITAT_DIFFICULTY,
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_SCORES,
  TIME_TO_TARGET_CREATION,
  TIME_TO_TARGET_ENHANCEMENT,
  TIME_TO_TARGET_MULTIPLIER,
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_SCORES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from './reference-constants.js'

export { BaselineLookupError } from './errors.js'
export { roundToSigFigs, MAX_SIG_FIGS } from './utils.js'
export { calculateAreaHabitatBaseline } from './baseline.js'
export {
  calculateHedgerowBaseline,
  calculateWatercourseBaseline,
  isRecognisedEncroachmentValue
} from './linear-baseline.js'
export { resolveDistinctiveness } from './multipliers.js'
