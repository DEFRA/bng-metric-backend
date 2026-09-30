// Layer-name resolution for the staged GeoPackage produced by the BNG Service
// QGIS template, which carries baseline and post-intervention as separate
// feature tables in one file.
//
// The existing LAYER_ALIASES map in geopackage.js resolves a single-stage file,
// where one table per habitat type holds both Baseline* and Proposed* columns.
// That format is unchanged and still supported; this module recognises the
// newer shape alongside it.
//
// Only the current table names are read: `Area Habitats`, `Vertical Area
// Habitats`, `Hedgerows`, `Watercourses` and `Individual Trees`, each with a
// ` Baseline` and a ` Post-Intervention` table. Files made with the earlier
// template (`Habitats …`, `Trees …`) are not read; findOutdatedStagedTables
// finds them so that the format gate can reject them with a clear message.

/** Logical habitat types, matching the keys readGeoPackage already uses. */
export const HABITAT_TYPES = Object.freeze({
  AREAS: 'areas',
  VERTICAL_AREAS: 'verticalAreas',
  HEDGEROWS: 'hedgerows',
  WATERCOURSES: 'watercourses',
  TREES: 'trees'
})

export const STAGE = Object.freeze({
  BASELINE: 'baseline',
  POST_INTERVENTION: 'postIntervention'
})

/** Table-name stem (lower-cased, stage suffix removed) → logical type. */
const TYPE_BY_STEM = Object.freeze({
  'area habitats': HABITAT_TYPES.AREAS,
  'vertical area habitats': HABITAT_TYPES.VERTICAL_AREAS,
  hedgerows: HABITAT_TYPES.HEDGEROWS,
  watercourses: HABITAT_TYPES.WATERCOURSES,
  'individual trees': HABITAT_TYPES.TREES
})

/**
 * Table names (lower-cased) of the earlier staged template, before `Habitats`
 * became `Area Habitats` and `Trees` became `Individual Trees`.
 */
const OUTDATED_STAGED_TABLES = Object.freeze([
  'habitats baseline',
  'habitats post-intervention',
  'trees baseline',
  'trees post-intervention'
])

const STAGE_SUFFIXES = Object.freeze([
  { suffix: ' post-intervention', stage: STAGE.POST_INTERVENTION },
  { suffix: ' post intervention', stage: STAGE.POST_INTERVENTION },
  { suffix: ' postintervention', stage: STAGE.POST_INTERVENTION },
  { suffix: ' baseline', stage: STAGE.BASELINE }
])

const REDLINE_NAMES = Object.freeze([
  'red line boundary',
  'red_line_boundary',
  'redline',
  'red_line'
])

/**
 * Resolve one GeoPackage feature-table name to its stage and habitat type.
 *
 * Returns null for anything unrecognised — reference tables, the NE template's
 * own single-stage tables, and any stray layer a surveyor has added. Callers
 * treat null as "not part of the staged model" rather than as an error, so an
 * unfamiliar table never breaks ingest.
 *
 * @param {string} tableName raw `gpkg_contents.table_name`
 * @returns {{ stage: string, type: string } | { redline: true } | null}
 */
export function resolveStagedLayer(tableName) {
  if (typeof tableName !== 'string') {
    return null
  }
  const name = tableName.trim().toLowerCase()
  if (REDLINE_NAMES.includes(name)) {
    return { redline: true }
  }
  for (const { suffix, stage } of STAGE_SUFFIXES) {
    if (!name.endsWith(suffix)) {
      continue
    }
    const stem = name.slice(0, -suffix.length).trim()
    const type = TYPE_BY_STEM[stem]
    return type ? { stage, type } : null
  }
  return null
}

/**
 * Tables named as in the earlier staged template. Such a file is not read: its
 * area habitat and tree tables would be ignored without a word, so the format
 * gate rejects it instead.
 *
 * @param {Iterable<string>} tableNames
 * @returns {string[]} the matching names, as given
 */
export function findOutdatedStagedTables(tableNames = []) {
  const found = []
  for (const name of tableNames) {
    if (
      typeof name === 'string' &&
      OUTDATED_STAGED_TABLES.includes(name.trim().toLowerCase())
    ) {
      found.push(name)
    }
  }
  return found
}

/**
 * True when the file carries at least one post-intervention table — i.e. it is
 * a staged GeoPackage rather than the older single-stage format.
 *
 * @param {string[]} tableNames
 * @returns {boolean}
 */
export function isStagedGeoPackage(tableNames = []) {
  return tableNames.some((name) => {
    const resolved = resolveStagedLayer(name)
    return resolved?.stage === STAGE.POST_INTERVENTION
  })
}

/**
 * Group table names by stage and type.
 *
 * @param {string[]} tableNames
 * @returns {{ redline: string[], baseline: Record<string,string>, postIntervention: Record<string,string>, ignored: string[] }}
 */
export function groupStagedTables(tableNames = []) {
  const grouped = {
    redline: [],
    [STAGE.BASELINE]: {},
    [STAGE.POST_INTERVENTION]: {},
    ignored: []
  }
  for (const name of tableNames) {
    const resolved = resolveStagedLayer(name)
    if (resolved === null) {
      grouped.ignored.push(name)
    } else if (resolved.redline) {
      grouped.redline.push(name)
    } else {
      grouped[resolved.stage][resolved.type] = name
    }
  }
  return grouped
}
