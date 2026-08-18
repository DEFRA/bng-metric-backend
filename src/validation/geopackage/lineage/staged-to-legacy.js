// Transform readStagedGeoPackage output into the per-stage `layers` objects
// the legacy persistence + enrichment pipeline consumes.
//
// The legacy pipeline (assign-feature-ids → calculate-habitat-sizes →
// extractHabitatData / extractPostIntervention → unit enrichment → persist)
// reads readGeoPackage's shape: one `layers` object of GeoJSON-ish Features
// `{ type: 'Feature', properties, nativeGeometry, nativeSrid }` keyed by
// logical layer name. A staged file carries BOTH stages in one file, so this
// module produces two such objects from one readStagedGeoPackage result —
// bridging every naming gap between the staged tables and the columns the
// legacy extract paths read:
//
//   * `PI Ref` → `Parcel Ref` (`Tree Ref` for trees). The post-intervention
//     extract reads the legacy ref columns; the staged tables carry the
//     feature's own reference as `PI Ref`. The ref is NOT rewritten for
//     Enhanced children — their baseline-length lookup is resolved by the
//     staged save path instead (extendBaselineLengthsForEnhancedChildren),
//     which maps each Enhanced child's own ref to its stamped parent's
//     baseline length. Rewriting the ref to the parent's would corrupt
//     featureId stability (the stored ref would stop matching `PI Ref` on
//     every re-upload) and collapse two children of one parent onto one ref.
//   * `featureId` — stamped upstream by assignStagedFeatureIds on the staged
//     shape, where the uuid-aware carry-forward keys live — is preserved on
//     the legacy Feature, so the legacy assign-feature-ids step is NOT run
//     for staged files (its ref-only keys would fight the uuid keys).
//   * The staged Trees Post-Intervention table spells the advance/delay
//     columns its own way ("Habitat Created/Enhanced in advance/years"); they
//     are aliased to the legacy spellings the tree extract reads.
//   * Geometry: staged features carry decoded GeoJSON plus the table SRID;
//     they are re-shaped to `nativeGeometry` / `nativeSrid`, which is what
//     PostGIS sizing and geometry persistence expect.
//
// Vertical Area Habitats have no legacy layer; they flow through under the
// `verticalAreas` key, which the extract and enrichment paths now understand.

import { HABITAT_TYPES } from './staged-layer-names.js'

/** Logical layer keys shared with readGeoPackage, in output order. */
const LEGACY_LAYER_KEYS = Object.freeze([
  HABITAT_TYPES.AREAS,
  HABITAT_TYPES.VERTICAL_AREAS,
  HABITAT_TYPES.HEDGEROWS,
  HABITAT_TYPES.WATERCOURSES,
  HABITAT_TYPES.TREES
])

/** Staged tree column → the legacy column the PI tree extract reads. */
const TREE_COLUMN_ALIASES = Object.freeze({
  'Habitat Created/Enhanced in advance/years':
    'Habitat created in advance/years',
  'Delay in starting habitat creation/enhancement in years':
    'Delay in starting habitat creation/years'
})

/**
 * @param {string} type one of HABITAT_TYPES
 * @returns {string} the ref column the legacy extract reads for this layer
 */
function legacyRefColumn(type) {
  return type === HABITAT_TYPES.TREES ? 'Tree Ref' : 'Parcel Ref'
}

/**
 * @param {object} stagedFeature a readStagedGeoPackage feature
 * @param {object} properties the (possibly bridged) property bag
 * @returns {{ type: 'Feature', featureId?: string, properties: object, nativeGeometry: object|null, nativeSrid: number }}
 */
function toLegacyFeature(stagedFeature, properties) {
  const feature = {
    type: 'Feature',
    properties,
    nativeGeometry: stagedFeature.geometry ?? null,
    nativeSrid: stagedFeature.srid
  }
  // Stamped upstream by assignStagedFeatureIds; the extract paths read it as
  // the stable join key, so it must survive the reshape. Absent (transformer
  // used before id assignment) the extract mints a fresh UUID as usual.
  if (stagedFeature.featureId) {
    feature.featureId = stagedFeature.featureId
  }
  return feature
}

/**
 * Build the legacy property bag for one post-intervention feature.
 *
 * @param {string} type one of HABITAT_TYPES
 * @param {object} feature a readStagedGeoPackage feature
 * @returns {object}
 */
function piLegacyProperties(type, feature) {
  const properties = { ...feature.properties }
  const ref = feature.piRef ?? feature.ref ?? null
  const refColumn = legacyRefColumn(type)
  if (ref !== null) {
    properties[refColumn] = ref
  }
  if (type === HABITAT_TYPES.TREES) {
    for (const [stagedColumn, legacyColumn] of Object.entries(
      TREE_COLUMN_ALIASES
    )) {
      if (properties[legacyColumn] == null && stagedColumn in properties) {
        properties[legacyColumn] = properties[stagedColumn]
      }
    }
  }
  return properties
}

/**
 * @param {object[]} redlineFeatures readStagedGeoPackage redline features
 * @returns {object} an empty legacy layers object with the red line mapped in
 */
function emptyLegacyLayers(redlineFeatures) {
  const layers = {
    redline: redlineFeatures.map((feature) =>
      toLegacyFeature(feature, { ...feature.properties })
    ),
    iggis: [],
    missingLayers: []
  }
  for (const key of LEGACY_LAYER_KEYS) {
    layers[key] = []
  }
  return layers
}

/**
 * Convert one readStagedGeoPackage result into the two per-stage legacy
 * `layers` objects. Pure: the staged input is never mutated, and the two
 * outputs share no feature or property objects.
 *
 * @param {{ redline: object[], baseline: Record<string, object[]>, postIntervention: Record<string, object[]> }} staged
 *   typically already through assignStagedFeatureIds, so features carry featureId
 * @returns {{ baseline: object, postIntervention: object }}
 */
export function stagedToLegacyLayers(staged) {
  const baseline = emptyLegacyLayers(staged.redline ?? [])
  const postIntervention = emptyLegacyLayers(staged.redline ?? [])
  for (const type of LEGACY_LAYER_KEYS) {
    baseline[type] = (staged.baseline?.[type] ?? []).map((feature) =>
      toLegacyFeature(feature, { ...feature.properties })
    )
    postIntervention[type] = (staged.postIntervention?.[type] ?? []).map(
      (feature) => toLegacyFeature(feature, piLegacyProperties(type, feature))
    )
  }
  return { baseline, postIntervention }
}
