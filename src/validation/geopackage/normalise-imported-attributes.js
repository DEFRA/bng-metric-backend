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
import { featureKeysForVariant, pickProp } from './properties.js'

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

/** Normalise one extracted habitat side in place, preserving raw properties. */
export function normaliseImportedAttributes(
  attributes,
  layer,
  postIntervention = false,
  onIssue = () => {}
) {
  const fields = { ...references[layer] }
  if (layer === 'habitats' || layer === 'trees') {
    fields.broadType = broadTypes
  }
  for (const [field, allowed] of Object.entries(fields)) {
    const originalValue = attributes[field] ?? null
    const value = normaliseValue(originalValue, field)
    attributes[field] = allowed.has(value) ? value : null
    if (attributes[field] === null) {
      onIssue({
        field,
        originalValue,
        reason:
          value === null &&
          (originalValue === null ||
            (typeof originalValue === 'string' && !originalValue.trim()))
            ? 'missing'
            : 'invalid'
      })
    }
  }
  if ('broadType' in fields && attributes.broadType === null) {
    attributes.type = null
  }
  if (attributes.type === null) {
    attributes.condition = null
    if (layer === 'watercourses') {
      attributes.watercourseEncroachment = null
      attributes.riparianEncroachment = null
    }
    if (postIntervention) {
      for (const field of [
        'strategicSignificance',
        'advanceYears',
        'delayYears'
      ]) {
        if (field in attributes) {
          attributes[field] = null
        }
      }
    }
  }
  return attributes
}

/** Apply import rules before enrichment and return non-fatal source issues. */
function sourceIssue(feature, layer, side, issue) {
  if (!feature.properties) {
    return issue
  }
  const keys = featureKeysForVariant(
    side === 'proposed' ? 'postIntervention' : 'baseline'
  )
  const typeKey = {
    habitats: 'habitatType',
    hedgerows: 'hedgerowType',
    watercourses: 'riverType'
  }[layer]
  const propertyKey =
    { broadType: 'broadHabitat', type: typeKey }[issue.field] ?? issue.field
  // Tree identity is derived from rural/urban classification rather than a
  // habitat-type source column. Other fields retain their exact source value.
  if (layer === 'trees' && ['type', 'broadType'].includes(issue.field)) {
    return issue
  }
  return {
    ...issue,
    originalValue: pickProp(feature.properties, keys[propertyKey])
  }
}

export function normaliseImportedDocument(document, postIntervention = false) {
  const issues = []
  for (const layer of Object.keys(references)) {
    for (const feature of document[layer] ?? []) {
      const sides = postIntervention ? ['baseline', 'proposed'] : [null]
      for (const side of sides) {
        const attributes = side ? feature[side] : feature
        if (!attributes) {
          continue
        }
        normaliseImportedAttributes(
          attributes,
          layer,
          side === 'proposed',
          (issue) => {
            issues.push({
              featureId: feature.featureId,
              ref: feature.ref ?? null,
              layer,
              side,
              ...sourceIssue(feature, layer, side, issue)
            })
          }
        )
      }
    }
  }
  return issues
}
