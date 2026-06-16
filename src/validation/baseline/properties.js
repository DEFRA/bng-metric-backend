// Property keys as written by Natural England QGIS templates. Lookups are
// case-insensitive (see pickProp) because some real-world files use
// underscored variants ("parcel_ref") or different casing.
export const PROP_KEYS = {
  parcelRef: ['Parcel Ref', 'Parcel_Ref', 'parcel_ref'],
  habitatType: ['Baseline Habitat Type', 'Baseline_Habitat_Type'],
  broadHabitat: ['Baseline Broad Habitat Type', 'Baseline_Broad_Habitat_Type'],
  hedgerowType: ['Baseline Hedge Type', 'Baseline_Hedge_Type'],
  riverType: ['Baseline River Type', 'Baseline_River_Type'],
  condition: ['Baseline Condition', 'Baseline_Condition'],
  strategicSignificance: [
    'Baseline Strategic Significance',
    'Baseline_Strategic_Significance'
  ],
  watercourseEncroachment: [
    'Baseline Encroachment into Watercourse',
    'Baseline_Encroachment_into_Watercourse'
  ],
  riparianEncroachment: [
    'Baseline Encroachment into riparian zone',
    'Baseline_Encroachment_into_riparian_zone'
  ],
  retentionCategory: ['Retention Category', 'Retention_Category'],
  area: ['Area', 'Shape_Area'],
  length: ['Length', 'Shape_Length'],
  // Survey / provenance / planning metadata columns shared (with minor
  // spelling differences) across the Habitats, Hedgerows and Rivers layers.
  // Promoted to named fields by BMD-498 so the baseline record carries them
  // explicitly rather than only inside the verbatim `properties` blob.
  siteName: ['Site Name', 'Site_Name'],
  surveyDate: ['Survey Date', 'Survey_Date'],
  surveyDetails: ['Survey Details', 'Survey_Details'],
  // Habitats spell it "Comment"; Hedgerows and Rivers use "Comments".
  comment: ['Comment', 'Comments', 'Comment_s'],
  mappedBy: ['Mapped by', 'Mapped_by'],
  company: ['Company'],
  baseMap: ['Base Map', 'Base_Map'],
  location: ['Location'],
  spatialRiskCategory: ['Spatial risk category', 'Spatial_risk_category'],
  habitatCreatedInAdvanceYears: [
    'Habitat created in advance/years',
    'Habitat_created_in_advance/years'
  ],
  delayInStartingHabitatCreationYears: [
    'Delay in starting habitat creation/years',
    'Delay_in_starting_habitat_creation/years'
  ],
  baselineDistinctiveness: [
    'Baseline Distinctiveness',
    'Baseline_Distinctiveness'
  ],
  // Rivers layer only.
  enhancementType: ['Enhancement Type', 'Enhancement_Type'],
  // Proposed (post-intervention) counterparts of the baseline-prefixed columns.
  // The NE template carries the proposed design in these columns; the
  // post-intervention save path reads them instead of the Baseline* columns
  // (see featureKeysForVariant).
  proposedHabitatType: ['Proposed Habitat Type', 'Proposed_Habitat_Type'],
  proposedBroadHabitat: [
    'Proposed Broad Habitat Type',
    'Proposed_Broad_Habitat_Type'
  ],
  proposedHedgerowType: ['Proposed Hedge Type', 'Proposed_Hedge_Type'],
  proposedRiverType: ['Proposed River Type', 'Proposed_River_Type'],
  proposedCondition: ['Proposed Condition', 'Proposed_Condition'],
  proposedStrategicSignificance: [
    'Proposed Strategic Significance',
    'Proposed_Strategic_Significance'
  ],
  proposedWatercourseEncroachment: [
    'Proposed Encroachment into Watercourse',
    'Proposed_Encroachment_into_Watercourse'
  ],
  proposedRiparianEncroachment: [
    'Proposed Encroachment into riparian zone',
    'Proposed_Encroachment_into_riparian_zone'
  ],
  proposedDistinctiveness: [
    'Proposed Distinctiveness',
    'Proposed_Distinctiveness'
  ],
  // fid is a GeoPackage-mandated lowercase column, so no real spelling
  // variants — listed here for consistency with the other property reads.
  fid: ['fid']
}

/** Document variants that select which set of attribute columns to read. */
export const EXTRACT_VARIANT = {
  BASELINE: 'baseline',
  POST_INTERVENTION: 'postIntervention'
}

/**
 * Resolve the logical attribute fields whose source column differs between the
 * baseline and post-intervention (proposed) documents. Fields not listed here
 * (parcel ref, retention category, survey/provenance metadata, enhancement
 * type, area/length) come from a single shared column regardless of variant
 * and are read with PROP_KEYS directly.
 *
 * @param {string} [variant] one of EXTRACT_VARIANT; defaults to baseline
 * @returns {Record<string, string[]>}
 */
export function featureKeysForVariant(variant = EXTRACT_VARIANT.BASELINE) {
  const proposed = variant === EXTRACT_VARIANT.POST_INTERVENTION
  return {
    parcelRef: PROP_KEYS.parcelRef,
    habitatType: proposed
      ? PROP_KEYS.proposedHabitatType
      : PROP_KEYS.habitatType,
    broadHabitat: proposed
      ? PROP_KEYS.proposedBroadHabitat
      : PROP_KEYS.broadHabitat,
    hedgerowType: proposed
      ? PROP_KEYS.proposedHedgerowType
      : PROP_KEYS.hedgerowType,
    riverType: proposed ? PROP_KEYS.proposedRiverType : PROP_KEYS.riverType,
    condition: proposed ? PROP_KEYS.proposedCondition : PROP_KEYS.condition,
    strategicSignificance: proposed
      ? PROP_KEYS.proposedStrategicSignificance
      : PROP_KEYS.strategicSignificance,
    watercourseEncroachment: proposed
      ? PROP_KEYS.proposedWatercourseEncroachment
      : PROP_KEYS.watercourseEncroachment,
    riparianEncroachment: proposed
      ? PROP_KEYS.proposedRiparianEncroachment
      : PROP_KEYS.riparianEncroachment,
    rawDistinctiveness: proposed
      ? PROP_KEYS.proposedDistinctiveness
      : PROP_KEYS.baselineDistinctiveness
  }
}

export function pickProp(properties, candidates) {
  if (!properties) {
    return null
  }
  for (const key of candidates) {
    if (key in properties && properties[key] != null) {
      return properties[key]
    }
  }
  const lowered = new Map(
    Object.keys(properties).map((k) => [k.toLowerCase(), k])
  )
  for (const key of candidates) {
    const hit = lowered.get(key.toLowerCase())
    if (hit && properties[hit] != null) {
      return properties[hit]
    }
  }
  return null
}

const BROAD_TYPE_SEPARATOR = ' - '

/**
 * Build the habitat lookup key used by getDistinctiveness — the full
 * "<broad> - <type>" string the reference table is keyed on. Real
 * QGIS-authored GeoPackages split this across two columns
 * (Baseline Broad Habitat Type + Baseline Habitat Type), so we read both
 * and concatenate. Some legacy fixtures (and a few inputs in the wild)
 * already store the full name in Baseline Habitat Type; those are passed
 * through unchanged so the lookup still works.
 *
 * Returns null when neither column carries a usable value.
 */
export function buildHabitatLookupKey(properties) {
  const habitatType = pickProp(properties, PROP_KEYS.habitatType)
  if (!habitatType || typeof habitatType !== 'string') {
    return null
  }
  if (habitatType.includes(BROAD_TYPE_SEPARATOR)) {
    return habitatType
  }
  const broad = pickProp(properties, PROP_KEYS.broadHabitat)
  if (!broad || typeof broad !== 'string') {
    return habitatType
  }
  return `${broad}${BROAD_TYPE_SEPARATOR}${habitatType}`
}
