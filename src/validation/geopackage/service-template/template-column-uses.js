import {
  FEATURE_UUID,
  GEOMETRY_COLUMN,
  PARENT_GEOM,
  PARENT_REF,
  PARENT_UUID
} from 'bng-library/bng-service'

import { PRIMARY_KEY } from './template-mapping.js'

/**
 * What the service does with each column of version 1.0 of the BNG Service
 * template, beside how the reader reads it (template-mapping.js). Together
 * they are the source of the generated template-to-service field mapping
 * (scripts/gen-template-mapping.js → data-dictionary/template-mapping.md).
 *
 * For each column of a layer:
 *
 * - `use`: `used` when the service reads its value; `ignored` when it does
 *   nothing with it (a column the reader drops is always ignored); `refused`
 *   when the service reads it only to refuse a file on it.
 * - `usedBy`: what reads it: the units `calculation`, a `validation` that
 *   refuses a file or an edit on its value, or the `display` of the stored
 *   value back to the user.
 * - `baseline` / `postIntervention`: the stored fields it fills, as paths
 *   under the stage's feature in the data dictionary (e.g. `baseline.type`
 *   for `postIntervention.habitats[].baseline.type`). Empty when the value
 *   is kept only in the feature's `properties`, as every column the reader
 *   keeps is. The geometry's stored field, the layer's PostGIS column, is
 *   added by the mapping (template-field-mapping.js).
 * - `note`: what a reader of the mapping needs to know beyond that.
 *
 * Every text column, read or not, is also checked at upload for its length
 * and, for a drop-down, that its list offers the value (text-values-gate.js).
 * That check is not repeated here as a use.
 *
 * A test (template-field-mapping.test.js) fails if a template column has no
 * entry, an entry names a column the template does not have, a dropped column
 * is not ignored, or a stored field is not in the data dictionary.
 */

export const USE = Object.freeze({
  USED: 'used',
  IGNORED: 'ignored',
  REFUSED: 'refused'
})

export const USED_BY = Object.freeze({
  CALCULATION: 'calculation',
  VALIDATION: 'validation',
  DISPLAY: 'display'
})

const { CALCULATION, VALIDATION, DISPLAY } = USED_BY

/**
 * @typedef {object} ColumnUse
 * @property {string} use one of USE
 * @property {string[]} usedBy each one of USED_BY
 * @property {string[]} baseline stored fields at the baseline stage
 * @property {string[]} postIntervention stored fields at the post-intervention stage
 * @property {string} note
 */

/**
 * A column read and stored.
 *
 * @param {string[]} usedBy
 * @param {{ baseline?: string[], postIntervention?: string[], note?: string }} [fields]
 * @returns {ColumnUse}
 */
const used = (
  usedBy,
  { baseline = [], postIntervention = [], note = '' } = {}
) => Object.freeze({ use: USE.USED, usedBy, baseline, postIntervention, note })

/**
 * A column the service does nothing with.
 *
 * @param {string} note why
 * @returns {ColumnUse}
 */
const ignored = (note) =>
  Object.freeze({
    use: USE.IGNORED,
    usedBy: [],
    baseline: [],
    postIntervention: [],
    note
  })

/** The same field at both stages: on the feature, and on the post-intervention feature's `baseline`. */
const baselineValue = (field) => ({
  baseline: [field],
  postIntervention: [`baseline.${field}`]
})

/** A post-intervention feature's proposed value. */
const proposedValue = (...fields) => ({
  postIntervention: fields.map((field) => `proposed.${field}`)
})

const MEASURED = 'Measured from the geometry instead.'
const DERIVED_DISTINCTIVENESS =
  'Derived from the habitat type instead, from the metric’s reference data.'
const NOT_PRICED_FROM_FILE =
  'Dropped: the service does not price spatial risk from the file.'

const ROW_KEY = used([VALIDATION], {
  note: 'The row’s primary key, kept in `properties`: a refusal names the row by it when the row has no Habitat Ref.'
})

const STORED_SHAPE =
  'Stored in the layer’s PostGIS table, keyed by featureId, and shown on the map.'
const SHAPE_CHECKED =
  'The geometry checks refuse a file on it: its type, whether it can be read, and whether it lies inside the Red Line Boundary.'

/** A feature's shape, which its size is measured from: a `measure` of it. */
const measuredShape = (measure) =>
  used([CALCULATION, VALIDATION, DISPLAY], {
    note: `${STORED_SHAPE} The ${measure} the units are priced on is measured from it. ${SHAPE_CHECKED}`
  })

/** A feature's shape, whose size a column gives instead. */
const unmeasuredShape = (sizedBy) =>
  used([VALIDATION, DISPLAY], {
    note: `${STORED_SHAPE} Its size comes from ${sizedBy}, not the shape. ${SHAPE_CHECKED}`
  })

const HABITAT_REF_NOTE =
  'Refused when blank (HABITAT_REF_MISSING) or holding invalid characters (HABITAT_REF_INVALID_CHARACTERS).'

const LINEAGE_USES = {
  [PARENT_REF]: ignored(
    'Kept in `properties`; the lineage follows parent_uuid, not the reference.'
  ),
  [FEATURE_UUID]: used([VALIDATION], {
    baseline: ['featureUuid'],
    note: 'Named by a post-intervention feature’s parent_uuid: the lineage checks match on it.'
  }),
  [PARENT_UUID]: used([CALCULATION, VALIDATION], {
    postIntervention: ['parentUuid', 'parentFeatureId'],
    note: 'Links the feature to its baseline parent, whose featureId is stored as parentFeatureId. The lineage checks (STAGED_PARENT_LINK_MISSING, STAGED_UNKNOWN_PARENT_REF, STAGED_AMBIGUOUS_PARENT) and what counts as retained, enhanced or lost follow it.'
  }),
  [PARENT_GEOM]: used([VALIDATION], {
    note: 'Kept in `properties`. The parent’s shape when the row was copied: refused when it no longer matches the parent’s baseline shape, or is missing or not valid WKT (STAGED_BASELINE_DRIFTED).'
  })
}

const CONDITION_AND_SIGNIFICANCE = {
  'Baseline Condition': used(
    [CALCULATION, DISPLAY],
    baselineValue('condition')
  ),
  'Baseline Strategic Significance': ignored(
    'Kept in `properties`; every baseline feature is stored, priced and shown at Low (BMD-1086), whatever the file says.'
  ),
  'Retention Category': used([CALCULATION, VALIDATION, DISPLAY], {
    postIntervention: ['retentionCategory'],
    note: 'Retained, Enhanced or Created: decides how the feature is priced and which lineage and degrade rules apply.'
  }),
  'Proposed Condition': used(
    [CALCULATION, VALIDATION, DISPLAY],
    proposedValue('condition')
  ),
  'Proposed Strategic Significance': used(
    [CALCULATION, DISPLAY],
    proposedValue('strategicSignificance', 'strategicSignificanceCategory')
  ),
  Comment: used([VALIDATION, DISPLAY], {
    baseline: ['comment'],
    postIntervention: ['comment'],
    note: 'Saved trimmed. Refused when not UTF-8 or over its length limit.'
  })
}

/** A habitat's timing columns, named as its layer names them. */
const timingUses = (advanceColumn, delayColumn) => ({
  [advanceColumn]: used([CALCULATION, VALIDATION, DISPLAY], {
    ...proposedValue('advanceYears'),
    note: 'Years, with 30+ read as 30; read as 0 when blank while the delay is above 0. With both set, the habitat is saved Incomplete.'
  }),
  [delayColumn]: used([CALCULATION, VALIDATION, DISPLAY], {
    ...proposedValue('delayYears'),
    note: 'Years, with 30+ read as 30; read as 0 when blank while the advance is above 0.'
  })
})

/** Every habitat layer but trees: identity, lineage, condition, timing. */
const HABITAT_USES = {
  [PRIMARY_KEY]: ROW_KEY,
  'Habitat Ref': used([VALIDATION, DISPLAY], {
    baseline: ['ref'],
    postIntervention: ['ref'],
    note: `Read as the pipeline’s Parcel Ref. ${HABITAT_REF_NOTE}`
  }),
  ...LINEAGE_USES,
  ...CONDITION_AND_SIGNIFICANCE,
  ...timingUses(
    'Habitat created in advance/years',
    'Delay in starting habitat creation/years'
  ),
  'Baseline Distinctiveness': ignored(DERIVED_DISTINCTIVENESS),
  'Proposed Distinctiveness': ignored(DERIVED_DISTINCTIVENESS),
  'Spatial risk category': ignored(NOT_PRICED_FROM_FILE)
}

/** Area and vertical area habitats: a broad and a specific habitat type. */
const AREA_TYPE_USES = {
  'Baseline Broad Habitat Type': used(
    [CALCULATION, DISPLAY],
    baselineValue('broadType')
  ),
  'Baseline Habitat Type': used([CALCULATION, VALIDATION, DISPLAY], {
    ...baselineValue('type'),
    note: 'Gives the habitat’s distinctiveness. Refused when out of the service’s scope (HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE).'
  }),
  'Proposed Broad Habitat Type': used(
    [CALCULATION, DISPLAY],
    proposedValue('broadType')
  ),
  'Proposed Habitat Type': used(
    [CALCULATION, VALIDATION, DISPLAY],
    proposedValue('type')
  ),
  'Irreplaceable Habitat': used([], {
    baseline: ['irreplaceable'],
    postIntervention: ['irreplaceable'],
    note: 'Stored as `irreplaceable` (Yes is true). Nothing else reads it yet: refusing an irreplaceable area habitat waits for BMD-1176.'
  })
}

/**
 * @type {Readonly<Record<string, Readonly<Record<string, ColumnUse>>>>}
 *   logical layer, as template-mapping.js keys it → template column → its use
 */
export const TEMPLATE_COLUMN_USES_1_0 = Object.freeze({
  redline: Object.freeze({
    [PRIMARY_KEY]: ignored(
      'Kept in `properties`: the Red Line Boundary holds one boundary, so nothing names it by its row.'
    ),
    [GEOMETRY_COLUMN]: used([VALIDATION, DISPLAY], {
      note: `The site’s boundary. ${STORED_SHAPE} Every feature is checked to lie inside it; the file is refused when it has none, more than one, or one that cannot be read, lies outside England or is too large.`
    }),
    ...Object.fromEntries(
      [
        'Site Name',
        'Location',
        'Survey Date',
        'Survey Details',
        'Mapped by',
        'Company',
        'Base Map'
      ].map((column) => [
        column,
        ignored('The Red Line Boundary is read for its geometry alone.')
      ])
    )
  }),
  areas: Object.freeze({
    ...HABITAT_USES,
    ...AREA_TYPE_USES,
    [GEOMETRY_COLUMN]: measuredShape('area'),
    Area: ignored(MEASURED)
  }),
  verticalHabitats: Object.freeze({
    ...HABITAT_USES,
    ...AREA_TYPE_USES,
    [GEOMETRY_COLUMN]: unmeasuredShape('its Area'),
    Area: used([CALCULATION, VALIDATION, DISPLAY], {
      baseline: ['sizeSquareMetres', 'area'],
      postIntervention: ['sizeSquareMetres', 'area'],
      note: 'The area the surveyor estimated on site, in hectares, which a line cannot give; stored in square metres. Refused when not above 0 (VERTICAL_HABITAT_AREA_NOT_POSITIVE).'
    })
  }),
  hedgerows: Object.freeze({
    ...HABITAT_USES,
    'Baseline Hedge Type': used(
      [CALCULATION, VALIDATION, DISPLAY],
      baselineValue('type')
    ),
    'Proposed Hedge Type': used(
      [CALCULATION, VALIDATION, DISPLAY],
      proposedValue('type')
    ),
    [GEOMETRY_COLUMN]: measuredShape('length'),
    Length: ignored(MEASURED),
    'Baseline Length': ignored(MEASURED)
  }),
  watercourses: Object.freeze({
    ...HABITAT_USES,
    'Baseline River Type': used(
      [CALCULATION, VALIDATION, DISPLAY],
      baselineValue('type')
    ),
    'Proposed River Type': used(
      [CALCULATION, VALIDATION, DISPLAY],
      proposedValue('type')
    ),
    'Baseline Encroachment into Watercourse': used(
      [CALCULATION, DISPLAY],
      baselineValue('watercourseEncroachment')
    ),
    'Baseline Encroachment into riparian zone': used(
      [CALCULATION, DISPLAY],
      baselineValue('riparianEncroachment')
    ),
    'Proposed Encroachment into Watercourse': used(
      [CALCULATION, DISPLAY],
      proposedValue('watercourseEncroachment')
    ),
    'Proposed Encroachment into riparian zone': used(
      [CALCULATION, DISPLAY],
      proposedValue('riparianEncroachment')
    ),
    'Enhancement Type': ignored(
      'Kept in `properties`; nothing reads it from a BNG Service template file yet.'
    ),
    [GEOMETRY_COLUMN]: measuredShape('length'),
    Length: ignored(MEASURED),
    'Baseline Length': ignored(MEASURED)
  }),
  trees: Object.freeze({
    [PRIMARY_KEY]: ROW_KEY,
    [GEOMETRY_COLUMN]: unmeasuredShape('its tree size: each point is one tree'),
    'Habitat Ref': used([VALIDATION, DISPLAY], {
      baseline: ['ref'],
      postIntervention: ['ref'],
      note: `Read as the pipeline’s Tree Ref. ${HABITAT_REF_NOTE}`
    }),
    ...LINEAGE_USES,
    ...CONDITION_AND_SIGNIFICANCE,
    ...timingUses(
      'Habitat Created/Enhanced in advance/years',
      'Delay in starting habitat creation/enhancement in years'
    ),
    'Baseline Tree Size': used([CALCULATION, DISPLAY], {
      ...baselineValue('treeSize'),
      note: 'Gives the tree’s area: each point is one tree.'
    }),
    'Baseline Tree Type': used([CALCULATION], baselineValue('treeSpecies')),
    'Baseline Rural or Urban Tree': used([CALCULATION, DISPLAY], {
      baseline: ['type', 'ruralOrUrban'],
      postIntervention: ['baseline.type', 'baseline.ruralOrUrban']
    }),
    'Proposed Tree Size': used(
      [CALCULATION, DISPLAY],
      proposedValue('treeSize')
    ),
    'Proposed Tree Type': used([CALCULATION], proposedValue('treeSpecies')),
    'Proposed Rural or Urban Tree': used(
      [CALCULATION, DISPLAY],
      proposedValue('type', 'ruralOrUrban')
    ),
    'Irreplaceable Habitat': Object.freeze({
      use: USE.REFUSED,
      usedBy: [VALIDATION],
      baseline: ['irreplaceable'],
      postIntervention: ['irreplaceable'],
      note: 'A tree marked Yes, or left blank, is refused (IRREPLACEABLE_TREE), so a stored tree’s `irreplaceable` is always false.'
    }),
    Category: used([VALIDATION], {
      note: 'Kept in `properties`. Existing or New: an Existing tree Created over its parent is that tree in a lower condition, which the lineage and degrade rules check.'
    }),
    'Spatial risk category': ignored(NOT_PRICED_FROM_FILE)
  })
})
