// Property keys as written by Natural England QGIS templates. Lookups are
// case-insensitive (see pickProp) because some real-world files use
// underscored variants ("parcel_ref") or different casing.
export const PROP_KEYS = {
  parcelRef: ['Parcel Ref', 'Parcel_Ref', 'parcel_ref'],
  habitatType: ['Baseline Habitat Type', 'Baseline_Habitat_Type'],
  broadHabitat: ['Baseline Broad Habitat Type', 'Baseline_Broad_Habitat_Type'],
  condition: ['Baseline Condition', 'Baseline_Condition'],
  strategicSignificance: [
    'Baseline Strategic Significance',
    'Baseline_Strategic_Significance'
  ],
  retentionCategory: ['Retention Category', 'Retention_Category'],
  riparianEncroachment: [
    'Baseline Encroachment into riparian zone',
    'Baseline_Encroachment_into_riparian_zone'
  ],
  watercourseEncroachment: [
    'Baseline Encroachment into Watercourse',
    'Baseline_Encroachment_into_Watercourse'
  ],
  area: ['Area', 'Shape_Area'],
  length: ['Length', 'Shape_Length'],
  // fid is a GeoPackage-mandated lowercase column, so no real spelling
  // variants — listed here for consistency with the other property reads.
  fid: ['fid']
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
