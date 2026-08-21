/**
 * The per-flow configuration the shared pipeline expects, keyed by the document
 * it writes. The synchronous routes hold the same shape; a job carries only its
 * `documentKey`, so it looks the rest up here.
 */
const VALIDATION_CONFIG_BY_DOCUMENT_KEY = Object.freeze({
  baseline: Object.freeze({
    routeName: 'validateBaselineJob',
    projectDocumentKey: 'baseline',
    uploadLabel: 'baseline',
    validationFailedMessage: 'Unable to validate baseline file'
  }),
  postIntervention: Object.freeze({
    routeName: 'validatePostInterventionJob',
    projectDocumentKey: 'postIntervention',
    uploadLabel: 'post-intervention',
    validationFailedMessage: 'Unable to validate post-intervention file'
  })
})

function validationConfigFor(documentKey) {
  const config = VALIDATION_CONFIG_BY_DOCUMENT_KEY[documentKey]
  if (!config) {
    throw new Error(`Unsupported validation documentKey: ${documentKey}`)
  }
  return config
}

export { VALIDATION_CONFIG_BY_DOCUMENT_KEY, validationConfigFor }
