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
//   * `Habitat Ref` → `Parcel Ref` (`Tree Ref` for trees), on both stages.
//     The extract paths read the legacy ref columns; every staged table
//     carries the feature's own reference as `Habitat Ref`. The ref is NOT
//     rewritten for Enhanced children — their baseline-length lookup is
//     resolved by the staged save path instead
//     (extendBaselineLengthsForEnhancedChildren), which maps each Enhanced
//     child's own ref to its stamped parent's baseline length. Rewriting the
//     ref to the parent's would corrupt featureId stability (the stored ref
//     would stop matching `Habitat Ref` on every re-upload) and collapse two
//     children of one parent onto one ref.
//   * Strategic significance: the template stores `Low` or `High`; the
//     extract paths, the stored documents and the frontend use the Metric
//     wordings, so the two significance columns are mapped here (see
//     SIGNIFICANCE_WORDING). NULL stays NULL, as a blank did before.
//   * `featureId` — stamped upstream by assignStagedFeatureIds on the staged
//     shape, where the uuid-aware carry-forward keys live — is preserved on
//     the legacy Feature, so the legacy assign-feature-ids step is NOT run
//     for staged files (its ref-only keys would fight the uuid keys).
//   * The staged Individual Trees Post-Intervention table spells the advance/delay
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

/** The significance columns the template stores as `Low` / `High`. */
const SIGNIFICANCE_COLUMNS = Object.freeze([
  'Baseline Strategic Significance',
  'Proposed Strategic Significance'
])

/** Metric wording for `Low`, the same for every habitat type. */
const SIGNIFICANCE_LOW_WORDING =
  'Area/compensation not in local strategy/ no local strategy'

/** Metric wordings for `High`: trees have their own. */
const SIGNIFICANCE_HIGH_WORDING = 'Formally identified in local strategy'
const TREE_SIGNIFICANCE_HIGH_WORDING =
  'Within area formally identified in local strategy'

/**
 * @param {string} type one of HABITAT_TYPES
 * @returns {Record<string, string>} template value → Metric wording
 */
function significanceWording(type) {
  return {
    Low: SIGNIFICANCE_LOW_WORDING,
    High:
      type === HABITAT_TYPES.TREES
        ? TREE_SIGNIFICANCE_HIGH_WORDING
        : SIGNIFICANCE_HIGH_WORDING
  }
}

/**
 * Replace `Low` / `High` in the significance columns with the Metric wording,
 * in place. NULL and any other value are left as they are.
 *
 * @param {string} type one of HABITAT_TYPES
 * @param {object} properties a property bag the caller owns
 */
function mapSignificance(type, properties) {
  const wording = significanceWording(type)
  for (const column of SIGNIFICANCE_COLUMNS) {
    const value = properties[column]
    if (typeof value === 'string' && Object.hasOwn(wording, value)) {
      properties[column] = wording[value]
    }
  }
}

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
 * Build the legacy property bag shared by both stages: the ref under its
 * legacy column, and significance in Metric wording.
 *
 * @param {string} type one of HABITAT_TYPES
 * @param {object} feature a readStagedGeoPackage feature
 * @returns {object}
 */
function legacyProperties(type, feature) {
  const properties = { ...feature.properties }
  if (feature.ref != null) {
    properties[legacyRefColumn(type)] = feature.ref
  }
  mapSignificance(type, properties)
  return properties
}

/**
 * Build the legacy property bag for one post-intervention feature.
 *
 * @param {string} type one of HABITAT_TYPES
 * @param {object} feature a readStagedGeoPackage feature
 * @returns {object}
 */
function piLegacyProperties(type, feature) {
  const properties = legacyProperties(type, feature)
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
      toLegacyFeature(feature, legacyProperties(type, feature))
    )
    postIntervention[type] = (staged.postIntervention?.[type] ?? []).map(
      (feature) => toLegacyFeature(feature, piLegacyProperties(type, feature))
    )
  }
  return { baseline, postIntervention }
}
