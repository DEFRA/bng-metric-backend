// Facade re-exporting the Creation/Enhancement linear multiplier helpers
// (split across linear-multiplier-shared.js, linear-creation-multipliers.js
// and linear-enhancement-multipliers.js to stay under the file-size limit)
// under their original names, so hedgerow/watercourse wrapper modules keep
// importing from a single place.
export {
  HEDGEROW_CONFIG,
  WATERCOURSE_CONFIG
} from './linear-multiplier-shared.js'
export {
  getLinearCreationDifficultyLabel,
  getLinearCreationDifficultyMultiplier,
  getLinearCreationTimeMultiplier,
  getLinearCreationTimeToTargetValue
} from './linear-creation-multipliers.js'
export {
  getLinearEnhancementDifficultyLabel,
  getLinearEnhancementDifficultyMultiplier,
  getLinearEnhancementTimeMultiplier,
  getLinearEnhancementTimeToTargetValue
} from './linear-enhancement-multipliers.js'
