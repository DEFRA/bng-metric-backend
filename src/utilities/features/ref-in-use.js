// Whether a rename would give a habitat a reference another baseline habitat
// already carries.
//
// The reference is how a post-intervention row finds its baseline parcel: the
// re-derive after an edit, feature-ID carry-forward on re-upload and the
// frontend's "View baseline details" link match on it within a layer, and the
// linear baseline lengths Enhanced hedgerows and watercourses are priced
// against are one map across both linear layers, where the last feature with a
// ref wins. A rename onto a reference already in use would merge two parcels'
// rows and could reprice them against the other parcel without a word, so the
// edit routes refuse it.
//
// Imports may still repeat a reference (BMD-1058): parcels that combine or
// split share one. This only stops an edit from creating a new clash.
//
// It applies to a legacy upload only. A BNG Service template upload links
// each post-intervention row to its baseline parent by id (parentFeatureId,
// BMD-1083), never by reference, so a rename there may repeat a reference
// another habitat carries (BMD-1180 AC7). The callers decide which applies:
// a template baseline edit does not ask, and a template Retained rename only
// renames its own row (apply-retained-ref-edit.js).

import { normaliseRef } from '../../validation/geopackage/carry-forward-feature-ids.js'

const LINEAR_LAYERS = Object.freeze(['hedgerows', 'watercourses'])

/** The baseline layers a reference must be unique across, by layer. */
const REF_SCOPE_BY_LAYER = Object.freeze({
  habitats: Object.freeze(['habitats']),
  hedgerows: LINEAR_LAYERS,
  watercourses: LINEAR_LAYERS
})

/**
 * Whether renaming `current` to `next` would clash with another baseline
 * habitat. Keeping the reference as it is never clashes, even where an import
 * already shared it.
 *
 * @param {object | undefined} baseline the project's baseline document
 * @param {{ layer: string, current: unknown, next: unknown, exceptFeatureId?: string | null }} rename
 *   `exceptFeatureId` is the baseline feature being renamed, which may carry
 *   the reference itself
 * @returns {boolean}
 */
export function renameClashes(
  baseline,
  { layer, current, next, exceptFeatureId = null }
) {
  const wanted = normaliseRef(next)
  if (wanted === null || wanted === normaliseRef(current)) {
    return false
  }
  const scope = REF_SCOPE_BY_LAYER[layer] ?? [layer]
  return scope.some((key) =>
    (baseline?.[key] ?? []).some(
      (feature) =>
        feature?.featureId !== exceptFeatureId &&
        normaliseRef(feature?.ref) === wanted
    )
  )
}
