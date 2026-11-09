import {
  BASELINE,
  FEATURE_UUID,
  HABITAT_REF,
  PARENT_GEOM,
  PARENT_REF,
  PARENT_UUID,
  POST_INTERVENTION,
  RED_LINE_BOUNDARY,
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION,
  tableName
} from 'bng-library/bng-service'

/**
 * How the service reads version 1.0 of the BNG Service template: which table
 * holds each of the pipeline's logical layers, and what each column becomes.
 *
 * The pipeline after the reader was written for the legacy template, and reads
 * features by the legacy column names. Most of the template's columns already
 * have those names; Habitat Ref is the one renamed. A column the service does
 * not use is dropped, so it never reaches the stored document: distinctiveness
 * is derived from the habitat type, and sizes are measured from the geometry,
 * bar a vertical area habitat's: its Area is the area the surveyor
 * estimated on site, in hectares, which a line cannot give.
 * An area habitat's Irreplaceable Habitat is read as its `irreplaceable`
 * status (irreplaceable.js).
 * The Red Line Boundary is read for its geometry alone.
 *
 * Individual trees are read under the legacy Urban Trees layer's names, which
 * the template keeps for every tree column but Habitat Ref. A tree's size is
 * the tree helper's area for its size class times its Count, so its Count is
 * read when the file has one; a file without one prices each point as a
 * single tree, as the Metric reads a blank Count.
 */

/** The legacy pipeline's name for a habitat's reference. */
const PARCEL_REF = 'Parcel Ref'

/** A habitat's or tree's irreplaceable status, read as `irreplaceable`. */
const IRREPLACEABLE_HABITAT = 'Irreplaceable Habitat'

/** The legacy pipeline's name for a tree's reference. */
const TREE_REF = 'Tree Ref'

/** A column the service does not read. */
const DROPPED = null

/** Kept under its own name. */
const kept = (...names) => names.map((name) => [name, name])

/** Not read. */
const dropped = (...names) => names.map((name) => [name, DROPPED])

/** Every layer's lineage columns. */
const LINEAGE_COLUMNS = kept(PARENT_REF, FEATURE_UUID, PARENT_UUID, PARENT_GEOM)

/** Every habitat layer: identity, lineage and the columns the story ignores. */
const COMMON_COLUMNS = [
  [HABITAT_REF, PARCEL_REF],
  ...LINEAGE_COLUMNS,
  ...kept(
    'Baseline Condition',
    'Baseline Strategic Significance',
    'Retention Category',
    'Proposed Condition',
    'Proposed Strategic Significance',
    'Habitat created in advance/years',
    'Delay in starting habitat creation/years',
    'Comment'
  ),
  ...dropped(
    'Baseline Distinctiveness',
    'Proposed Distinctiveness',
    'Spatial risk category'
  )
]

const LAYER_COLUMNS = {
  areas: [
    ...COMMON_COLUMNS,
    ...kept(
      'Baseline Broad Habitat Type',
      'Baseline Habitat Type',
      'Proposed Broad Habitat Type',
      'Proposed Habitat Type',
      // Read as `irreplaceable`; refusing a file with one that is waits for
      // BMD-1176.
      IRREPLACEABLE_HABITAT
    ),
    ...dropped('Area')
  ],
  verticalHabitats: [
    ...COMMON_COLUMNS,
    ...kept(
      'Baseline Broad Habitat Type',
      'Baseline Habitat Type',
      'Proposed Broad Habitat Type',
      'Proposed Habitat Type',
      IRREPLACEABLE_HABITAT,
      // Hectares, as entered: the service stores it in square metres, as
      // every area habitat's size is stored.
      'Area'
    )
  ],
  hedgerows: [
    ...COMMON_COLUMNS,
    ...kept('Baseline Hedge Type', 'Proposed Hedge Type'),
    ...dropped('Length', 'Baseline Length')
  ],
  watercourses: [
    ...COMMON_COLUMNS,
    ...kept(
      'Baseline River Type',
      'Proposed River Type',
      'Baseline Encroachment into Watercourse',
      'Baseline Encroachment into riparian zone',
      'Proposed Encroachment into Watercourse',
      'Proposed Encroachment into riparian zone',
      'Enhancement Type'
    ),
    ...dropped('Length', 'Baseline Length')
  ],
  trees: [
    [HABITAT_REF, TREE_REF],
    ...LINEAGE_COLUMNS,
    ...kept(
      'Baseline Tree Size',
      'Baseline Tree Type',
      'Baseline Rural or Urban Tree',
      'Baseline Condition',
      'Baseline Strategic Significance',
      // Read as `irreplaceable`: the service refuses an irreplaceable tree
      // (irreplaceable-tree-check.js).
      IRREPLACEABLE_HABITAT,
      'Retention Category',
      'Category',
      'Proposed Tree Size',
      'Proposed Tree Type',
      'Proposed Rural or Urban Tree',
      'Proposed Condition',
      'Proposed Strategic Significance',
      'Habitat Created/Enhanced in advance/years',
      'Delay in starting habitat creation/enhancement in years',
      'Count',
      'Comment'
    ),
    ...dropped('Spatial risk category')
  ]
}

/** bng-library's key for the template layer behind each habitat layer. */
const TEMPLATE_LAYERS = {
  areas: 'habitats',
  verticalHabitats: 'verticalHabitats',
  hedgerows: 'hedgerows',
  watercourses: 'rivers',
  trees: 'trees'
}

/** The suffix of each stage's tables, e.g. "Area Habitats Baseline". */
const STAGE_TABLE_SUFFIX = {
  [STAGE_BASELINE]: BASELINE,
  [STAGE_POST_INTERVENTION]: POST_INTERVENTION
}

const RED_LINE_COLUMNS = dropped(
  'Site Name',
  'Location',
  'Survey Date',
  'Survey Details',
  'Mapped by',
  'Company',
  'Base Map'
)

/**
 * @typedef {object} LayerMapping
 * @property {(stage: string) => string} table the template table for a stage,
 *   one of bng-library's STAGE_BASELINE or STAGE_POST_INTERVENTION
 * @property {Map<string, string | null>} columns template column → the name
 *   the pipeline reads it by, or null when it is not read
 */

/** @type {Readonly<Record<string, LayerMapping>>} */
const LAYER_MAPPINGS = Object.freeze({
  redline: Object.freeze({
    table: () => RED_LINE_BOUNDARY,
    columns: new Map(RED_LINE_COLUMNS)
  }),
  ...Object.fromEntries(
    Object.entries(LAYER_COLUMNS).map(([logical, columns]) => [
      logical,
      Object.freeze({
        table: (stage) =>
          tableName(TEMPLATE_LAYERS[logical], STAGE_TABLE_SUFFIX[stage]),
        columns: new Map(columns)
      })
    ])
  )
})

/**
 * Version 1.0's mapping: each logical layer the service reads, by the key the
 * pipeline knows it by (`redline`, `areas`, `verticalHabitats`, `hedgerows`,
 * `watercourses`, `trees`).
 */
export const TEMPLATE_MAPPING_1_0 = LAYER_MAPPINGS
