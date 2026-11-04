import { calculateCreatedWatercoursePostIntervention } from 'bng-library/metric'
import {
  getWatercourseHabitatTypes,
  getConditionsForWatercourseType,
  getWatercourseEncroachmentOptions,
  getRiparianEncroachmentOptions
} from './habitat-reference.js'
import { buildLinearCreationReference } from './linear-creation.js'

const reference = buildLinearCreationReference({
  featureType: 'watercourse',
  types: getWatercourseHabitatTypes(),
  conditions: getConditionsForWatercourseType,
  calculate: (name, condition) =>
    calculateCreatedWatercoursePostIntervention(
      1,
      name,
      condition,
      'No Encroachment',
      'No Encroachment/No Encroachment',
      0,
      0,
      'Low'
    ),
  extra: {
    watercourseEncroachment: getWatercourseEncroachmentOptions(),
    riparianEncroachment: getRiparianEncroachmentOptions()
  }
})

export function getWatercourseCreationReference() {
  return structuredClone(reference)
}
