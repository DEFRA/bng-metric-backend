import { FEATURE_UUID, PARENT_UUID } from 'bng-library/bng-service'

/**
 * Link each post-intervention feature of a BNG Service template upload to the
 * baseline feature its row names by `parent_uuid` (BMD-1083), by giving it
 * that feature's `featureId` as `parentFeatureId`, whatever its Retention
 * Category. A feature that names no parent is left without one. The parent
 * checks (parent-links.js) have already refused a file whose links cannot be
 * trusted, so every link found here is sound.
 *
 * The frontend links a feature to its parent with it (BMD-1086), and the
 * Enhanced linear calculations take the parent's measured length through it
 * (linear-baseline-length-by-ref.js), not by ref.
 */

/** The document layers a template upload links: those the service reads. */
const LINKED_LAYERS = Object.freeze(['habitats', 'hedgerows', 'watercourses'])

const text = (value) =>
  value === null || value === undefined || String(value).trim() === ''
    ? null
    : String(value).trim()

/**
 * @param {object} postIntervention the post-intervention document, extracted
 * @param {object} baseline the baseline document saved with it, with its
 *   features' ids assigned
 * @returns {object} `postIntervention`, its linked features given their
 *   `parentFeatureId`
 */
export function linkToParents(postIntervention, baseline) {
  for (const layer of LINKED_LAYERS) {
    // A uuid two baseline features share links neither: the parent checks
    // refuse a row that names one (STAGED_AMBIGUOUS_PARENT).
    const parentIds = new Map()
    for (const parent of baseline?.[layer] ?? []) {
      const uuid = text(parent.properties?.[FEATURE_UUID])
      if (uuid !== null) {
        parentIds.set(uuid, parentIds.has(uuid) ? null : parent.featureId)
      }
    }
    for (const feature of postIntervention[layer] ?? []) {
      const parentId = parentIds.get(text(feature.properties?.[PARENT_UUID]))
      if (parentId) {
        feature.parentFeatureId = parentId
      }
    }
  }
  return postIntervention
}
