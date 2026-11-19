import {
  createdLinearEditPayload,
  validateCreatedLinearEdit
} from './created-feature-edit.js'
import { getHedgerowCreationReference } from '../validation/reference/hedgerow-creation.js'
import { getHedgerowEnhancementReference } from '../validation/reference/hedgerow-enhancement.js'

export const postInterventionHedgerowEditPayload = createdLinearEditPayload(
  getHedgerowCreationReference()
)

// A Created hedgerow's edit (BMD-1049), or an Enhanced one's, within the
// valid enhancements of its baseline (BMD-1046).
export function validateCreatedHedgerowEdit(feature, edits) {
  return validateCreatedLinearEdit(
    feature,
    edits,
    getHedgerowCreationReference(),
    'hedgerow',
    {
      enhancedReference: (enhanced) =>
        getHedgerowEnhancementReference(enhanced.baseline ?? {}),
      keepsStoredChoices: true
    }
  )
}
