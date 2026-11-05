import { calculateCreatedHedgerowPostIntervention } from 'bng-library/metric'
import {
  getHedgerowHabitatTypes,
  getConditionsForHedgerowType
} from './habitat-reference.js'
import { buildLinearCreationReference } from './linear-creation.js'

const reference = buildLinearCreationReference({
  featureType: 'hedgerow',
  types: getHedgerowHabitatTypes(),
  conditions: getConditionsForHedgerowType,
  calculate: (name, condition) =>
    calculateCreatedHedgerowPostIntervention(1, name, condition, 0, 0, 'Low')
})

export function getHedgerowCreationReference() {
  return structuredClone(reference)
}
