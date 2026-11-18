// Which template's uploads fill a project document field, while the
// service-template flag lets both be uploaded (BMD-1085). A field is tagged
// with `.meta(BNG_SERVICE_ONLY)` or `.meta(LEGACY_ONLY)`; an untagged field is
// filled from either, and a field under a tagged one takes its tag. The data
// dictionary and the warehouse ERD show it, so downstream consumers can tell
// which fields a document from each template has. The legacy-only fields go
// with the legacy template (BMD-1097).

export const TEMPLATES = Object.freeze({
  BOTH: 'both',
  BNG_SERVICE: 'bng-service',
  LEGACY: 'legacy',
  // A legacy-only field of a feature only a BNG Service template file has,
  // such as a vertical area habitat's survey details: it is always empty.
  NEITHER: 'neither'
})

/** A field only a BNG Service template upload fills. */
export const BNG_SERVICE_ONLY = Object.freeze({
  template: TEMPLATES.BNG_SERVICE
})

/** A field only a legacy template upload fills. */
export const LEGACY_ONLY = Object.freeze({ template: TEMPLATES.LEGACY })

/** How the data dictionary and the ERD name each. */
export const TEMPLATE_LABELS = Object.freeze({
  [TEMPLATES.BOTH]: 'Both',
  [TEMPLATES.BNG_SERVICE]: 'BNG Service',
  [TEMPLATES.LEGACY]: 'Legacy',
  [TEMPLATES.NEITHER]: 'Neither (always empty)'
})

/**
 * A field's template, from a Joi describe() node and the template of the field
 * it sits under.
 *
 * @param {object} node a Joi describe() node
 * @param {string} [inherited] the enclosing field's template
 * @returns {string} one of TEMPLATES
 */
export function templateOf(node, inherited = TEMPLATES.BOTH) {
  const own = (node?.metas ?? []).find((meta) => meta?.template)?.template
  if (!own || own === inherited) {
    return inherited
  }
  if (inherited === TEMPLATES.BOTH) {
    return own
  }
  return TEMPLATES.NEITHER
}
