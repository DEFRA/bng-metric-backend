import { templateForVersion } from './supported-versions.js'

// The pipeline reads a BNG Service template file's columns by the legacy
// template's names (template-mapping.js), so a row's Habitat Ref reaches the
// extractors as Parcel Ref, or Tree Ref on a tree. The stored document keeps
// each row's attributes in `properties`, and a new-template document is keyed
// by the new template's names (BMD-1085), so the renamed columns are put back
// under the template's own names once the document is built. Nothing reads
// them from a stored document by the legacy names: the reference is the
// feature's `ref`.

/** Each document layer → the logical layer its mapping is held under. */
const LOGICAL_LAYER = Object.freeze({
  habitats: 'areas',
  verticalHabitats: 'verticalHabitats',
  hedgerows: 'hedgerows',
  watercourses: 'watercourses',
  trees: 'trees'
})

/**
 * The columns a layer's mapping reads under another name: the pipeline's name
 * → the template's.
 *
 * @param {import('./template-mapping.js').LayerMapping} layerMapping
 * @returns {Map<string, string>}
 */
export function renamedColumns(layerMapping) {
  const renamed = new Map()
  for (const [column, readAs] of layerMapping.columns) {
    if (readAs !== null && readAs !== column) {
      renamed.set(readAs, column)
    }
  }
  return renamed
}

/**
 * @param {object | undefined} properties
 * @param {Map<string, string>} renamed
 * @returns {object | undefined} a copy under the template's names
 */
function withTemplateNames(properties, renamed) {
  if (!properties) {
    return properties
  }
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      renamed.get(key) ?? key,
      value
    ])
  )
}

/**
 * Key each feature's `properties` by the template's column names, for a
 * document built from a BNG Service template file. A legacy file's document
 * has no `template` and is returned as it is.
 *
 * @param {object} document a baseline or post-intervention document
 * @returns {object} the same document
 */
export function storeTemplateColumnNames(document) {
  const mapping = document?.template
    ? templateForVersion(document.template.version)?.mapping
    : null
  if (!mapping) {
    return document
  }
  for (const [layer, logical] of Object.entries(LOGICAL_LAYER)) {
    const renamed = renamedColumns(mapping[logical])
    for (const feature of document[layer] ?? []) {
      feature.properties = withTemplateNames(feature.properties, renamed)
    }
  }
  return document
}
