import {
  getHabitatsByBroad,
  getConditionsForHabitatType,
  getConditionsForHedgerowType,
  getConditionsForWatercourseType
} from '../reference/habitat-reference.js'

const areaHabitatPairs = getHabitatsByBroad()
const conditionsByLayer = {
  habitats: getConditionsForHabitatType,
  trees: getConditionsForHabitatType,
  hedgerows: getConditionsForHedgerowType,
  watercourses: getConditionsForWatercourseType
}

function areaHabitatKey(attributes) {
  const pair = areaHabitatPairs.find(
    ({ broadHabitat, habitatType }) =>
      broadHabitat === attributes.broadType &&
      (habitatType === attributes.type ||
        `${broadHabitat} - ${habitatType}` === attributes.type)
  )
  return pair ? `${pair.broadHabitat} - ${pair.habitatType}` : null
}

function clearFields(attributes, fields) {
  for (const field of fields) {
    if (field in attributes) {
      attributes[field] = null
    }
  }
}

function nullInvalidCondition(attributes, layer, habitatKey) {
  if (
    habitatKey &&
    attributes.condition != null &&
    !conditionsByLayer[layer](habitatKey).some(
      ({ condition }) => condition === attributes.condition
    )
  ) {
    attributes.condition = null
  }
}

export function normaliseImportedAttributeCombinations(
  attributes,
  layer,
  clearStrategic = false
) {
  if (!attributes?.type) {
    return
  }
  const area = layer === 'habitats' || layer === 'trees'
  const habitatKey = area ? areaHabitatKey(attributes) : attributes.type
  if (layer === 'habitats' && attributes.broadType && !habitatKey) {
    clearFields(attributes, [
      'type',
      'condition',
      'watercourseEncroachment',
      'riparianEncroachment',
      'advanceYears',
      'delayYears'
    ])
    if (clearStrategic) {
      clearFields(attributes, ['strategicSignificance'])
    }
    return
  }
  nullInvalidCondition(attributes, layer, habitatKey)
}

export const IMPORT_COMBINATION_LAYERS = Object.freeze(
  Object.keys(conditionsByLayer)
)

/** Apply baseline combination rules after standalone validation. */
export function normaliseImportedCombinations(document) {
  for (const layer of IMPORT_COMBINATION_LAYERS) {
    for (const feature of document[layer] ?? []) {
      normaliseImportedAttributeCombinations(feature, layer)
    }
  }
  return document
}
