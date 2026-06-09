const FEATURE_LAYERS = [
  { type: 'habitat', key: 'habitats' },
  { type: 'hedgerow', key: 'hedgerows' },
  { type: 'watercourse', key: 'watercourses' }
]

/**
 * Locate a feature in a document feature set by featureId, returning the layer
 * it belongs to. Lets routes address any project feature by its UUID alone —
 * the type comes from the data.
 *
 * Relies on featureIds being unique across habitats, hedgerows and
 * watercourses (they're generated as UUIDs at validation time, so
 * collisions are vanishingly unlikely). If a duplicate is ever observed it
 * indicates upstream data corruption and we throw rather than silently
 * returning the wrong layer's feature.
 *
 * @param {object} featureSet
 * @param {string} featureId
 * @returns {{ type: string, key: string, feature: object } | null}
 * @throws {Error} when the same featureId appears in more than one layer
 */
function findFeature(featureSet, featureId) {
  if (!featureSet) {
    return null
  }
  const matches = []
  for (const { type, key } of FEATURE_LAYERS) {
    const found = featureSet[key]?.find((f) => f?.featureId === featureId)
    if (found) {
      matches.push({ type, key, feature: found })
    }
  }
  if (matches.length > 1) {
    throw new Error(
      `featureId ${featureId} appears in multiple layers: ${matches
        .map((m) => m.type)
        .join(', ')}`
    )
  }
  return matches[0] ?? null
}

export { findFeature, FEATURE_LAYERS }
