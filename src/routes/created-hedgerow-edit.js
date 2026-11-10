import {
  createdLinearEditPayload,
  validateCreatedLinearEdit
} from './created-feature-edit.js'
import { getHedgerowCreationReference } from '../validation/reference/hedgerow-creation.js'

export const postInterventionHedgerowEditPayload = createdLinearEditPayload(
  getHedgerowCreationReference()
)

export function validateCreatedHedgerowEdit(feature, edits) {
  return validateCreatedLinearEdit(
    feature,
    edits,
    getHedgerowCreationReference(),
    'hedgerow'
  )
}
