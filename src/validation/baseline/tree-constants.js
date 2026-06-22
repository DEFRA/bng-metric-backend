// Individual trees ("Urban Trees" layer in the NE template) are modelled as a
// special area habitat: a single broad habitat ("Individual trees") split into
// two habitat types — urban and rural — that the bng-metric-engine reference
// data keys as "Individual trees - Urban tree" / "Individual trees - Rural tree".
// The GeoPackage carries only "Urban" / "Rural" in the Rural-or-Urban column, so
// we map that to the engine habitat type here.

/** Broad habitat stored on every individual-tree feature. */
export const INDIVIDUAL_TREES_BROAD_HABITAT = 'Individual trees'

/** Habitat type for an urban individual tree. */
export const URBAN_TREE_TYPE = 'Urban tree'

/** Habitat type for a rural individual tree. */
export const RURAL_TREE_TYPE = 'Rural tree'

/**
 * Map the GeoPackage "Rural or Urban Tree" column value to the engine habitat
 * type. Tolerant of "Urban", "urban tree", "Rural", etc.; returns null for
 * missing or unrecognised values so the feature is left Incomplete.
 *
 * @param {unknown} ruralOrUrban
 * @returns {string|null}
 */
export function treeHabitatTypeFromRuralUrban(ruralOrUrban) {
  if (typeof ruralOrUrban !== 'string') {
    return null
  }
  const value = ruralOrUrban.trim().toLowerCase()
  if (value.includes('urban')) {
    return URBAN_TREE_TYPE
  }
  if (value.includes('rural')) {
    return RURAL_TREE_TYPE
  }
  return null
}
