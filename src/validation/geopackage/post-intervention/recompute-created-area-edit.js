import {
  calculateCreatedAreaHabitatPostIntervention,
  MAX_YEARS,
  MAX_YEARS_PLUS,
  OVER_MAX_YEARS
} from 'bng-library/metric'
import { getAreaCreationReference } from '../../reference/area-creation.js'
import { pricedAreaHectares } from '../../../utilities/enrichment/shared/enrich-units-shared.js'
import {
  resolveAdvanceOrDelay,
  resolveFinalYears,
  resolveFinalTimeToTargetCondition
} from '../../../utilities/enrichment/post-intervention/proposed-time-difficulty-display.js'

function typeDerivedFields(type) {
  return {
    distinctiveness: type?.distinctiveness ?? null,
    distinctivenessScore: type?.distinctivenessScore ?? null,
    difficulty: type?.difficulty ?? null,
    difficultyMultiplier: type?.difficultyMultiplier ?? null
  }
}

function conditionDerivedFields(condition) {
  if (!condition) {
    return { conditionScore: null, standardTimeToTargetCondition: null }
  }
  const standardYears =
    condition.years === MAX_YEARS_PLUS
      ? OVER_MAX_YEARS
      : String(condition.years)
  return {
    conditionScore: condition.score,
    standardTimeToTargetCondition: standardYears
  }
}

function inputYears(value) {
  return value === MAX_YEARS_PLUS ? MAX_YEARS : Number(value)
}

function storedYears(value) {
  return value === MAX_YEARS_PLUS ? MAX_YEARS : value
}

function timingPopulated(proposed) {
  return proposed.advanceYears !== null && proposed.delayYears !== null
}

function applyTiming(proposed, condition, reference) {
  if (!timingPopulated(proposed)) {
    return
  }
  proposed.advanceOrDelay = resolveAdvanceOrDelay(
    proposed.advanceYears,
    proposed.delayYears
  )
  if (!condition) {
    return
  }
  const key = String(
    resolveFinalYears(
      inputYears(condition.years),
      condition.years === MAX_YEARS_PLUS,
      inputYears(proposed.advanceYears),
      inputYears(proposed.delayYears)
    )
  )
  proposed.timeMultiplier = reference.timeMultipliers[key]
  proposed.finalTimeToTargetCondition =
    resolveFinalTimeToTargetCondition(proposed)
}

function proposedAttributes(existing, edits, reference, type, condition) {
  const significance = reference.strategicSignificance.find(
    (s) => s.value === edits.strategicSignificance
  )
  return {
    ...existing,
    broadType: edits.broadType,
    type: edits.habitatType,
    condition: edits.condition,
    strategicSignificance: edits.strategicSignificance,
    strategicSignificanceCategory: significance?.value ?? null,
    strategicSignificanceScore: significance?.score ?? null,
    rejectedStrategicSignificance: null,
    advanceYears: storedYears(edits.advanceYears),
    delayYears: storedYears(edits.delayYears),
    advanceYearsIs30Plus: edits.advanceYears === MAX_YEARS_PLUS,
    delayYearsIs30Plus: edits.delayYears === MAX_YEARS_PLUS,
    ...typeDerivedFields(type),
    ...conditionDerivedFields(condition),
    timeMultiplier: null,
    finalTimeToTargetCondition: null,
    advanceOrDelay: null
  }
}

function canCalculate(feature, type, condition, sizeHa) {
  const proposed = feature.proposed
  const identityComplete = Boolean(feature.ref && type && condition)
  const risksComplete = [
    proposed.strategicSignificanceScore,
    proposed.timeMultiplier,
    proposed.difficultyMultiplier
  ].every((value) => value !== null)
  return (
    identityComplete &&
    risksComplete &&
    timingPopulated(proposed) &&
    sizeHa !== null
  )
}

function applyCalculation(feature, sizeHa, type, condition) {
  const proposed = feature.proposed
  const calculated = calculateCreatedAreaHabitatPostIntervention(
    sizeHa,
    `${type.broad} - ${type.name}`,
    condition.condition,
    proposed.advanceYears,
    proposed.delayYears,
    proposed.strategicSignificanceCategory
  )
  feature.units = calculated.units
  // The saved risk and its display use the same calculator result.
  proposed.difficultyMultiplier = calculated.difficultyMultiplier
  proposed.timeMultiplier = calculated.timeMultiplier
  proposed.finalTimeToTargetCondition =
    resolveFinalTimeToTargetCondition(proposed)
}

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
  feature.ref = edits.ref.trim()
  feature.proposed = proposedAttributes(
    feature.proposed,
    edits,
    reference,
    type,
    condition
  )
  applyTiming(feature.proposed, condition, reference)
  const sizeHa = pricedAreaHectares(feature)
  const complete = canCalculate(feature, type, condition, sizeHa)
  feature.units = null
  if (complete) {
    applyCalculation(feature, sizeHa, type, condition)
  }
  feature.status = complete ? 'Complete' : 'Incomplete'
  return {
    distinctiveness: feature.proposed.distinctiveness,
    units: feature.units,
    status: feature.status,
    updatedFeature: feature
  }
}
