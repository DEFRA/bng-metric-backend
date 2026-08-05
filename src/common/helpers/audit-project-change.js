import { audit } from '@defra/cdp-auditing'

const PROJECT_AUDIT_EVENT = 'project-data.changed'

/**
 * Emit a structured event to the CDP audit stream after a successful change to
 * auditable project data. Full project/habitat values remain in the immutable
 * database audit snapshot and are deliberately excluded here to avoid sending
 * potentially sensitive or very large payloads to the central audit stream.
 *
 * @param {object} event
 * @param {string} event.actorId verified Defra ID token subject
 * @param {string} event.projectId project whose data changed
 * @param {'created'|'updated'} event.operation
 * @param {string} event.dataType documented auditable data type
 * @param {string} [event.featureId] changed habitat feature, when applicable
 * @param {string} [event.uploadId] source upload, when applicable
 */
function auditProjectChange({
  actorId,
  projectId,
  operation,
  dataType,
  featureId,
  uploadId
}) {
  audit(
    {
      event: PROJECT_AUDIT_EVENT,
      outcome: 'succeeded',
      actorId,
      projectId,
      operation,
      dataType,
      ...(featureId ? { featureId } : {}),
      ...(uploadId ? { uploadId } : {})
    },
    `Project data ${operation}`
  )
}

export { auditProjectChange, PROJECT_AUDIT_EVENT }
