function numericTotal(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function percentageChange(netUnitChange, baselineTotal) {
  if (baselineTotal <= 0) {
    return null
  }

  return (netUnitChange / baselineTotal) * 100
}

function areaUnitsTotal(units = {}) {
  return numericTotal(units.habitatsTotal) + numericTotal(units.treesTotal)
}

/**
 * Calculate post-intervention net unit changes from persisted unit totals.
 *
 * Area habitats include individual trees, which are stored separately in the
 * persisted totals but are part of the area-habitat metric module.
 *
 * @param {object} baselineUnits
 * @param {object} postInterventionUnits
 * @returns {object}
 */
export function calculatePostInterventionNetUnitChanges(
  baselineUnits = {},
  postInterventionUnits = {}
) {
  const baselineAreaUnits = areaUnitsTotal(baselineUnits)
  const postInterventionAreaUnits = areaUnitsTotal(postInterventionUnits)
  const habitatsNetUnitChange = postInterventionAreaUnits - baselineAreaUnits

  const hedgerowsBaselineTotal = numericTotal(baselineUnits.hedgerowsTotal)
  const hedgerowsNetUnitChange =
    numericTotal(postInterventionUnits.hedgerowsTotal) - hedgerowsBaselineTotal

  const watercoursesBaselineTotal = numericTotal(
    baselineUnits.watercoursesTotal
  )
  const watercoursesNetUnitChange =
    numericTotal(postInterventionUnits.watercoursesTotal) -
    watercoursesBaselineTotal

  return {
    habitatsNetUnitChange,
    habitatsNetUnitChangePercentage: percentageChange(
      habitatsNetUnitChange,
      baselineAreaUnits
    ),
    hedgerowsNetUnitChange,
    hedgerowsNetUnitChangePercentage: percentageChange(
      hedgerowsNetUnitChange,
      hedgerowsBaselineTotal
    ),
    watercoursesNetUnitChange,
    watercoursesNetUnitChangePercentage: percentageChange(
      watercoursesNetUnitChange,
      watercoursesBaselineTotal
    )
  }
}
