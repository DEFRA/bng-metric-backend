import { HABITAT_STATUS } from '../../../services/upload/habitat-status.js'

const requiredAttributesByLayer = {
  habitats: ['type', 'condition'],
  trees: ['type', 'condition'],
  hedgerows: ['type', 'condition'],
  watercourses: [
    'type',
    'condition',
    'watercourseEncroachment',
    'riparianEncroachment'
  ]
}

// Enrichment can mark retained features Complete using baseline units alone.
// Missing required attributes must still leave the saved feature Incomplete,
// both during import and when stored documents are re-derived after edits.
export function enforceRequiredAttributeCompleteness(
  document,
  postIntervention = false
) {
  for (const [layer, fields] of Object.entries(requiredAttributesByLayer)) {
    for (const feature of document[layer] ?? []) {
      const attributes = postIntervention ? feature.proposed : feature
      if (fields.some((field) => attributes?.[field] == null)) {
        feature.status = HABITAT_STATUS.INCOMPLETE
      }
    }
  }
}
