/**
 * Sum `units` on features that have a finite numeric value (uncalculated rows are skipped).
 *
 * @param {object[] | undefined} features
 * @returns {number}
 */
export function sumFeatureUnits(features) {
  if (!Array.isArray(features)) {
    return 0
  }
  let total = 0
  for (const feature of features) {
    const units = feature?.units
    if (typeof units === 'number' && Number.isFinite(units)) {
      total += units
    }
  }
  return total
}

/**
 * Sets `featureSet.units` with cumulative units per layer and overall.
 *
 * @param {{ habitats?: object[], hedgerows?: object[], watercourses?: object[] }} featureSet
 * @returns {typeof featureSet}
 */
export function summarizeFeatureSetUnitsTotals(featureSet) {
  const habitatsTotal = sumFeatureUnits(featureSet?.habitats)
  const hedgerowsTotal = sumFeatureUnits(featureSet?.hedgerows)
  const watercoursesTotal = sumFeatureUnits(featureSet?.watercourses)
  const totalUnits = habitatsTotal + hedgerowsTotal + watercoursesTotal

  featureSet.units = {
    totalUnits,
    habitatsTotal,
    hedgerowsTotal,
    watercoursesTotal
  }
  return featureSet
}
