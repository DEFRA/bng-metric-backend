import {
  GPKG_RETENTION_LOST,
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  RETENTION_RETAINED,
  importedRetentionCategory
} from '../../../utilities/enrichment/post-intervention/retention-category.js'

import {
  IMPORT_COMBINATION_LAYERS,
  normaliseImportedAttributeCombinations
} from '../normalise-imported-combinations.js'

function isCreatedOrEnhanced(retention) {
  return retention === RETENTION_CREATED || retention === RETENTION_ENHANCED
}

function normaliseTiming(proposed, retention, layer) {
  if (!proposed) {
    return
  }
  // Lost area parcels are replacement habitats. Their timing follows Created
  // rules, including AC3's conflict check, rather than AC5's redundant fields.
  const timingRetention =
    layer === 'habitats' && retention === GPKG_RETENTION_LOST
      ? RETENTION_CREATED
      : retention
  const redundant =
    timingRetention === RETENTION_RETAINED ||
    timingRetention === GPKG_RETENTION_LOST
  const conflicting =
    isCreatedOrEnhanced(timingRetention) &&
    Number.parseFloat(proposed.advanceYears) > 0 &&
    Number.parseFloat(proposed.delayYears) > 0
  if (redundant || conflicting) {
    proposed.advanceYears = null
    proposed.delayYears = null
  }
}

/** Validate both sides, then remove conflicting or redundant proposed timing. */
export function normaliseProposedCombinations(document) {
  for (const layer of IMPORT_COMBINATION_LAYERS) {
    for (const feature of document[layer] ?? []) {
      const retention = importedRetentionCategory(feature)
      normaliseImportedAttributeCombinations(feature.baseline, layer)
      normaliseImportedAttributeCombinations(
        feature.proposed,
        layer,
        isCreatedOrEnhanced(retention)
      )
      normaliseTiming(feature.proposed, retention, layer)
    }
  }
  return document
}
