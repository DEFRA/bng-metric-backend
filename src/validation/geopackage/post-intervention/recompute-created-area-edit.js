import { calculateCreatedAreaHabitatPostIntervention } from 'bng-library/metric'
import { getAreaCreationReference } from '../../reference/area-creation.js'
import { pricedAreaHectares } from '../../../utilities/enrichment/shared/enrich-units-shared.js'
import { resolveFinalTimeToTargetCondition } from '../../../utilities/enrichment/post-intervention/proposed-time-difficulty-display.js'

// Standard difficulty is type-derived. Saved units and applied multipliers use
// the same metric calculator as import; partial edits preserve independent values.
export function recomputeCreatedAreaEdit(existing, edits) {
  const feature = structuredClone(existing)
  const reference = getAreaCreationReference()
  const type = reference.habitatTypes.find(
    (t) => t.broad === edits.broadType && t.name === edits.habitatType
  )
  const condition = type?.conditions.find(
    (c) => c.condition === edits.condition
  )
  const significance = reference.strategicSignificance.find(
    (s) => s.value === edits.strategicSignificance
  )
  const proposed = {
    ...feature.proposed,
    broadType: edits.broadType,
    type: edits.habitatType,
    condition: edits.condition,
    strategicSignificance: edits.strategicSignificance,
    strategicSignificanceCategory: significance?.value ?? null,
    strategicSignificanceScore: significance?.score ?? null,
    rejectedStrategicSignificance: null,
    advanceYears: edits.advanceYears,
    delayYears: edits.delayYears,
    distinctiveness: type?.distinctiveness ?? null,
    distinctivenessScore: type?.distinctivenessScore ?? null,
    conditionScore: condition?.score ?? null,
    difficulty: type?.difficulty ?? null,
    difficultyMultiplier: type?.difficultyMultiplier ?? null,
    standardTimeToTargetCondition: condition
      ? String(condition.years === '30+' ? '>30' : condition.years)
      : null,
    timeMultiplier: null,
    finalTimeToTargetCondition: null,
    advanceOrDelay: null
  }
  const timingPopulated =
    edits.advanceYears !== null && edits.delayYears !== null
  if (condition && timingPopulated) {
    const inputYears = (value) => (value === '30+' ? 30 : Number(value))
    const standardYears = inputYears(condition.years)
    const finalYears = Math.max(
      0,
      standardYears +
        inputYears(edits.delayYears) -
        inputYears(edits.advanceYears)
    )
    const key =
      finalYears > 30 ||
      (condition.years === '30+' && inputYears(edits.advanceYears) === 0)
        ? '30+'
        : String(finalYears)
    proposed.timeMultiplier = reference.timeMultipliers[key]
    proposed.finalTimeToTargetCondition = resolveFinalTimeToTargetCondition({
      ...proposed,
      advanceYears: inputYears(edits.advanceYears),
      delayYears: inputYears(edits.delayYears)
    })
  }
  feature.ref = edits.ref.trim()
  feature.proposed = proposed
  const sizeHa = pricedAreaHectares(feature)
  const complete = Boolean(
    feature.ref &&
    type &&
    condition &&
    significance &&
    timingPopulated &&
    sizeHa !== null &&
    proposed.timeMultiplier !== null &&
    proposed.difficultyMultiplier !== null
  )
  feature.units = 0
  if (complete) {
    const calculated = calculateCreatedAreaHabitatPostIntervention(
      sizeHa,
      `${type.broad} - ${type.name}`,
      condition.condition,
      edits.advanceYears,
      edits.delayYears,
      significance.value
    )
    feature.units = calculated.units
    // Applied risk can change on Save; the editable page previews the standard
    // type difficulty until then, as required by AC6 and AC10.
    proposed.difficultyMultiplier = calculated.difficultyMultiplier
    proposed.timeMultiplier = calculated.timeMultiplier
  }
  feature.status = complete ? 'Complete' : 'Incomplete'
  return {
    distinctiveness: proposed.distinctiveness,
    units: feature.units,
    status: feature.status,
    updatedFeature: feature
  }
}
