// Which features an edit renamed, so the geometry rows can follow (BMD-1061).
//
// Every PostGIS geometry row carries a copy of its feature's ref, written at
// upload (persist-upload.js). An edit that renames a baseline feature renames
// it in the project document and, through the re-derive, the post-intervention
// rows joined to it (resync-post-intervention-baseline.js). This lists every
// feature whose ref moved, in either document, by comparing the document before
// the edit with the pieces the edit produced.

const LAYER_KEYS = Object.freeze([
  'habitats',
  'hedgerows',
  'watercourses',
  'trees'
])

function refsById(features) {
  const byId = new Map()
  for (const feature of Array.isArray(features) ? features : []) {
    if (feature?.featureId) {
      byId.set(feature.featureId, feature.ref ?? null)
    }
  }
  return byId
}

function renamedInLayer(documentKey, layer, before, after) {
  const previous = refsById(before)
  const renamed = []
  for (const feature of Array.isArray(after) ? after : []) {
    const id = feature?.featureId
    if (id && previous.has(id) && previous.get(id) !== (feature.ref ?? null)) {
      renamed.push({ documentKey, layer, featureId: id, ref: feature.ref })
    }
  }
  return renamed
}

/**
 * @param {object} project the project document as it stood before the edit
 * @param {{ documentKey: string, layer: string, feature: object, postIntervention: object | null }} edit
 *   the edited feature and its layer, plus the re-derived post-intervention
 *   document when a baseline edit produced one
 * @returns {Array<{ documentKey: string, layer: string, featureId: string, ref: string }>}
 */
export function listRenamedRefs(
  project,
  { documentKey, layer, feature, postIntervention }
) {
  const renamed = renamedInLayer(
    documentKey,
    layer,
    project?.[documentKey]?.[layer],
    [feature]
  )
  if (postIntervention) {
    for (const key of LAYER_KEYS) {
      renamed.push(
        ...renamedInLayer(
          'postIntervention',
          key,
          project?.postIntervention?.[key],
          postIntervention[key]
        )
      )
    }
  }
  return renamed
}
