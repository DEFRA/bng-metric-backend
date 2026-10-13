import {
  CONDITION_SCORES,
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
  normaliseEncroachmentLabel
} from 'bng-library/metric'

import { getHabitatsByBroad } from '../reference/habitat-reference.js'
import { stripConditionPrefix } from '../../utilities/enrichment/shared/condition.js'

import { enforceRequiredAttributeCompleteness } from '../../utilities/enrichment/shared/required-attribute-completeness.js'

const areaHabitats = getHabitatsByBroad()
const broadTypes = new Set(areaHabitats.map((row) => row.broadHabitat))
// Membership is independent of the selected broad habitat/condition. Invalid
// combinations are handled separately by BMD-1060.
const areaTypes = new Set(
  areaHabitats.flatMap(({ broadHabitat, habitatType }) => [
    habitatType,
    `${broadHabitat} - ${habitatType}`
  ])
)

function conditions(table) {
  return new Set(Object.values(table).flatMap((row) => Object.keys(row)))
}

const references = {
  habitats: { type: areaTypes, condition: conditions(CONDITION_SCORES) },
  trees: { type: areaTypes, condition: conditions(CONDITION_SCORES) },
  hedgerows: {
    type: new Set(Object.keys(HEDGEROW_DISTINCTIVENESS_CATEGORIES)),
    condition: conditions(HEDGEROW_CONDITION_SCORES)
  },
  watercourses: {
    type: new Set(Object.keys(WATERCOURSE_DISTINCTIVENESS_CATEGORIES)),
    condition: conditions(WATERCOURSE_CONDITION_SCORES),
    watercourseEncroachment: new Set(
      Object.keys(WATERCOURSE_ENCROACHMENT_MULTIPLIER)
    ),
    riparianEncroachment: new Set(
      Object.keys(WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER)
    )
  }
}

function normaliseValue(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  if (field === 'condition') {
    return stripConditionPrefix(value)
  }
  if (field.endsWith('Encroachment')) {
    return normaliseEncroachmentLabel(value)
  }
  return value.trim()
}

function nullPopulatedFields(attributes, fields) {
  for (const field of fields) {
    if (field in attributes) {
      attributes[field] = null
    }
  }
}

function clearDependentAttributes(attributes, layer, postIntervention) {
  if (attributes.type !== null) {
    return
  }
  attributes.condition = null
  if (layer === 'watercourses') {
    attributes.watercourseEncroachment = null
    attributes.riparianEncroachment = null
  }
  if (postIntervention) {
    nullPopulatedFields(attributes, [
      'strategicSignificance',
      'advanceYears',
      'delayYears'
    ])
  }
}

/** Normalise one extracted habitat side in place, preserving raw properties. */
export function normaliseImportedAttributes(
  attributes,
  layer,
  postIntervention = false
) {
  const fields = { ...references[layer] }
  if (layer === 'habitats' || layer === 'trees') {
    fields.broadType = broadTypes
  }
  for (const [field, allowed] of Object.entries(fields)) {
    const value = normaliseValue(attributes[field], field)
    attributes[field] = allowed.has(value) ? value : null
  }
  if ('broadType' in fields && attributes.broadType === null) {
    attributes.type = null
  }
  clearDependentAttributes(attributes, layer, postIntervention)
  return attributes
}

function normaliseFeatureSide(feature, layer, side) {
  const attributes = side ? feature[side] : feature
  if (attributes) {
    normaliseImportedAttributes(attributes, layer, side === 'proposed')
  }
}

/** Apply null-handling rules in place before enrichment. */
export function normaliseImportedDocument(document, postIntervention = false) {
  const sides = postIntervention ? ['baseline', 'proposed'] : [null]
  for (const layer of Object.keys(references)) {
    for (const feature of document[layer] ?? []) {
      for (const side of sides) {
        normaliseFeatureSide(feature, layer, side)
      }
    }
  }
  enforceRequiredAttributeCompleteness(document, postIntervention)
  return document
}
