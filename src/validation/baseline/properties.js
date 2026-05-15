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
  area: ['Area', 'Shape_Area'],
  length: ['Length', 'Shape_Length']
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
