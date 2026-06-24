/**
 * Joi validation schemas for the post-intervention feature records stored in
 * `project.postIntervention`. Each habitat/hedgerow/watercourse feature is
 * split into nested `baseline` and `proposed` sub-objects so the two sets of
 * GPKG columns are clearly distinguished in the persisted JSON.
 *
 * These schemas are imported by project.js and consumed by the route
 * validation in baseline.js.
 */
import Joi from 'joi'

import {
  habitatSizesSummarySchema,
  baselineUnitsTotalsSchema,
  redLineSchema,
  featureDataEnvelopeFields
} from './project-shared-schemas.js'

const DISTINCTIVENESS_SCORE_DESCRIPTION =
  'Numeric distinctiveness score for the band, from bng-metric-engine.'

// ──────────────────────────────────────────────────────────────────────────────
// Shared sub-object factories
// ──────────────────────────────────────────────────────────────────────────────

function baselineCommonFields() {
  return {
    condition: Joi.string()
      .allow(null, '')
      .description(
        'Baseline condition assessment stripped of list-index prefix.'
      ),
    conditionScore: Joi.number()
      .allow(null)
      .description(
        'Numeric condition score set during post-intervention enrichment.'
      ),
    distinctiveness: Joi.string()
      .allow(null, '')
      .description('Distinctiveness band resolved by bng-metric-engine.'),
    distinctivenessScore: Joi.number()
      .allow(null)
      .description(DISTINCTIVENESS_SCORE_DESCRIPTION)
  }
}

function proposedCommonFields() {
  return {
    ...baselineCommonFields(),
    advanceYears: Joi.number()
      .allow(null)
      .description(
        'Habitat created in advance (years) from the GeoPackage; null when the column is N/A (typical for Lost features).'
      ),
    delayYears: Joi.number()
      .allow(null)
      .description(
        'Delay in starting habitat creation (years) from the GeoPackage; null when the column is N/A (typical for Lost features).'
      )
  }
}

// Top-level fields shared by every post-intervention area-type feature
// (polygon parcels and individual trees): the join key, ref, area/size, units
// and status. `proposed`/`baseline` sub-objects and `properties` are appended
// per feature type.
function postInterventionAreaFeatureFields({
  geometryRow,
  refDescription,
  areaDescription,
  sizeDescription,
  unitsDescription
}) {
  return {
    featureId: Joi.string()
      .uuid()
      .required()
      .description(
        `UUID assigned on import; join key to the ${geometryRow} geometry row.`
      ),
    ref: Joi.string().allow(null, '').description(refDescription),
    area: Joi.number().allow(null).description(areaDescription),
    sizeSquareMetres: Joi.number().allow(null).description(sizeDescription),
    units: Joi.number().allow(null).description(unitsDescription),
    status: Joi.string()
      .valid('Complete', 'Incomplete')
      .required()
      .description(
        "'Complete' when proposed broad type, type and condition are all set."
      )
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Area habitat sub-schemas
// ──────────────────────────────────────────────────────────────────────────────

const postInterventionHabitatBaselineSubSchema = Joi.object({
  type: Joi.string()
    .allow(null, '')
    .description(
      'Baseline habitat type from the GeoPackage Baseline Habitat Type column.'
    ),
  broadType: Joi.string()
    .allow(null, '')
    .description('Baseline broad habitat type.'),
  ...baselineCommonFields(),
  strategicSignificance: Joi.string()
    .allow(null, '')
    .description('Baseline Strategic Significance from the GeoPackage.'),
  retentionCategory: Joi.string()
    .allow(null, '')
    .description('Retention Category from the GeoPackage.')
}).description(
  'Baseline habitat values extracted from the Baseline * GeoPackage columns.'
)

const postInterventionHabitatProposedSubSchema = Joi.object({
  type: Joi.string()
    .allow(null, '')
    .description(
      'Proposed habitat type from the GeoPackage Proposed Habitat Type column.'
    ),
  broadType: Joi.string()
    .allow(null, '')
    .description('Proposed broad habitat type.'),
  ...proposedCommonFields(),
  strategicSignificance: Joi.string()
    .allow(null, '')
    .description('Proposed Strategic Significance from the GeoPackage.')
}).description(
  'Proposed habitat values extracted from the Proposed * GeoPackage columns.'
)

const postInterventionHabitatSchema = Joi.object({
  ...postInterventionAreaFeatureFields({
    geometryRow: 'bng.baseline_habitats',
    refDescription: 'Parcel reference from the GeoPackage (Parcel Ref column).',
    areaDescription:
      'Parcel area in square metres, rounded to the nearest integer.',
    sizeDescription:
      'Exact parcel area in square metres as measured in PostGIS.',
    unitsDescription:
      'Post-intervention biodiversity units for the parcel, calculated from proposed values.'
  }),
  baseline: postInterventionHabitatBaselineSubSchema,
  proposed: postInterventionHabitatProposedSubSchema,
  properties: Joi.object()
    .unknown(true)
    .description(
      'Raw attribute columns copied verbatim from the GeoPackage Habitats layer.'
    )
}).description(
  'A post-intervention area (polygon) habitat parcel with nested baseline and proposed sub-objects.'
)

// ──────────────────────────────────────────────────────────────────────────────
// Individual tree sub-schemas
// ──────────────────────────────────────────────────────────────────────────────

// Fields shared by both tree sides. Trees are points, so each side carries its
// own notional area (derived from that side's tree-size band) on top of the
// distinctiveness/condition block reused from the area-habitat sub-objects.
function treeSideCommonFields() {
  return {
    type: Joi.string()
      .allow(null, '')
      .description(
        "Tree habitat type — 'Urban tree' or 'Rural tree', derived from the Rural or Urban Tree column."
      ),
    broadType: Joi.string()
      .allow(null, '')
      .description("Always 'Individual trees' for tree features."),
    ...baselineCommonFields(),
    strategicSignificance: Joi.string()
      .allow(null, '')
      .description('Strategic Significance from the GeoPackage.'),
    treeSize: Joi.string()
      .allow(null, '')
      .description(
        "Tree size band from the GeoPackage (e.g. 'Medium'); determines the per-tree area."
      ),
    treeSpecies: Joi.string()
      .allow(null, '')
      .description('Tree species/type free text (Tree Type column).'),
    ruralOrUrban: Joi.string()
      .allow(null, '')
      .description(
        'Raw Rural or Urban Tree value as written in the GeoPackage.'
      ),
    sizeSquareMetres: Joi.number()
      .allow(null)
      .description('Notional tree area in square metres (per-size reference).'),
    area: Joi.number()
      .allow(null)
      .description('Notional tree area in square metres, rounded.')
  }
}

const postInterventionTreeBaselineSubSchema = Joi.object({
  ...treeSideCommonFields(),
  retentionCategory: Joi.string()
    .allow(null, '')
    .description('Retention Category from the GeoPackage.')
}).description(
  'Baseline individual-tree values from the Baseline * GeoPackage columns.'
)

const postInterventionTreeProposedSubSchema = Joi.object({
  ...treeSideCommonFields(),
  advanceYears: Joi.number()
    .allow(null)
    .description(
      'Habitat created in advance (years) from the GeoPackage; null when N/A.'
    ),
  delayYears: Joi.number()
    .allow(null)
    .description(
      'Delay in starting habitat creation (years) from the GeoPackage; null when N/A.'
    )
}).description(
  'Proposed individual-tree values from the Proposed * GeoPackage columns.'
)

const postInterventionTreeSchema = Joi.object({
  ...postInterventionAreaFeatureFields({
    geometryRow: 'bng.post_intervention_trees',
    refDescription: 'Tree reference from the GeoPackage (Tree Ref column).',
    areaDescription:
      'Notional tree area in square metres (proposed side), rounded.',
    sizeDescription: 'Notional tree area in square metres (proposed side).',
    unitsDescription:
      'Post-intervention biodiversity units for the tree, calculated from proposed values.'
  }),
  count: Joi.number()
    .allow(null)
    .description(
      'Count column from the GeoPackage; each tree is treated as a single tree (one row).'
    ),
  baseline: postInterventionTreeBaselineSubSchema,
  proposed: postInterventionTreeProposedSubSchema,
  properties: Joi.object()
    .unknown(true)
    .description(
      'Raw attribute columns copied verbatim from the GeoPackage Urban Trees layer.'
    )
}).description(
  'A post-intervention individual tree (point) with nested baseline and proposed sub-objects.'
)

// ──────────────────────────────────────────────────────────────────────────────
// Hedgerow sub-schemas
// ──────────────────────────────────────────────────────────────────────────────

const postInterventionLinearBaselineSubSchema = Joi.object({
  type: Joi.string()
    .allow(null, '')
    .description('Baseline hedgerow type from Baseline Hedge Type column.'),
  ...baselineCommonFields()
}).description(
  'Baseline hedgerow values from the Baseline * GeoPackage columns.'
)

const postInterventionLinearProposedSubSchema = Joi.object({
  type: Joi.string()
    .allow(null, '')
    .description('Proposed hedgerow type from Proposed Hedge Type column.'),
  ...proposedCommonFields()
}).description(
  'Proposed hedgerow values from the Proposed * GeoPackage columns.'
)

const postInterventionLinearHabitatSchema = Joi.object({
  featureId: Joi.string()
    .uuid()
    .required()
    .description(
      'UUID assigned on import; join key to the bng.baseline_hedgerows geometry row.'
    ),
  ref: Joi.string()
    .allow(null, '')
    .description('Feature reference from the GeoPackage.'),
  length: Joi.number()
    .allow(null)
    .description('Length in metres (PostGIS size, rounded).'),
  sizeMetres: Joi.number()
    .allow(null)
    .description('Length in metres as measured in PostGIS.'),
  units: Joi.number()
    .allow(null)
    .description(
      'Post-intervention biodiversity units, calculated from proposed values.'
    ),
  status: Joi.string()
    .valid('Complete', 'Incomplete')
    .required()
    .description("'Complete' when proposed type and condition are both set."),
  baseline: postInterventionLinearBaselineSubSchema,
  proposed: postInterventionLinearProposedSubSchema,
  properties: Joi.object()
    .unknown(true)
    .description(
      'Raw attribute columns copied verbatim from the GeoPackage Hedgerows layer.'
    )
}).description('A post-intervention hedgerow (linear) feature.')

// ──────────────────────────────────────────────────────────────────────────────
// Watercourse sub-schemas
// ──────────────────────────────────────────────────────────────────────────────

const watercourseEncroachmentFields = {
  riparianEncroachment: Joi.string()
    .allow(null, '')
    .description('Riparian-zone encroachment category.'),
  watercourseEncroachment: Joi.string()
    .allow(null, '')
    .description('Watercourse encroachment category.'),
  strategicSignificance: Joi.string()
    .allow(null, '')
    .description('Strategic Significance from the GeoPackage.'),
  waterEncroachmentMultiplier: Joi.number()
    .allow(null)
    .description(
      'Watercourse-encroachment multiplier applied by bng-metric-engine when computing units.'
    ),
  riparianEncroachmentMultiplier: Joi.number()
    .allow(null)
    .description(
      'Riparian-encroachment multiplier applied by bng-metric-engine when computing units.'
    )
}

const postInterventionWatercourseBaselineSubSchema = Joi.object({
  type: Joi.string()
    .allow(null, '')
    .description('Baseline watercourse type from Baseline River Type column.'),
  ...baselineCommonFields(),
  ...watercourseEncroachmentFields
}).description(
  'Baseline watercourse values from the Baseline * GeoPackage columns.'
)

const postInterventionWatercourseProposedSubSchema = Joi.object({
  type: Joi.string()
    .allow(null, '')
    .description('Proposed watercourse type from Proposed River Type column.'),
  ...proposedCommonFields(),
  ...watercourseEncroachmentFields
}).description(
  'Proposed watercourse values from the Proposed * GeoPackage columns.'
)

const postInterventionWatercourseSchema = Joi.object({
  featureId: Joi.string()
    .uuid()
    .required()
    .description(
      'UUID assigned on import; join key to the bng.baseline_watercourses geometry row.'
    ),
  ref: Joi.string()
    .allow(null, '')
    .description('Feature reference from the GeoPackage.'),
  length: Joi.number()
    .allow(null)
    .description('Length in metres (PostGIS size, rounded).'),
  sizeMetres: Joi.number()
    .allow(null)
    .description('Length in metres as measured in PostGIS.'),
  units: Joi.number()
    .allow(null)
    .description(
      'Post-intervention biodiversity units, calculated from proposed values.'
    ),
  status: Joi.string()
    .valid('Complete', 'Incomplete')
    .required()
    .description(
      "'Complete' when all proposed fields including encroachments are set."
    ),
  baseline: postInterventionWatercourseBaselineSubSchema,
  proposed: postInterventionWatercourseProposedSubSchema,
  properties: Joi.object()
    .unknown(true)
    .description(
      'Raw attribute columns copied verbatim from the GeoPackage Watercourses layer.'
    )
}).description('A post-intervention watercourse (linear) feature.')

// ──────────────────────────────────────────────────────────────────────────────
// Top-level post-intervention data schema
// ──────────────────────────────────────────────────────────────────────────────

const postInterventionDataSchema = Joi.object({
  ...featureDataEnvelopeFields,
  redLine: redLineSchema,
  habitats: Joi.array()
    .items(postInterventionHabitatSchema)
    .description('Post-intervention area (polygon) habitat parcels.'),
  trees: Joi.array()
    .items(postInterventionTreeSchema)
    .description('Post-intervention individual tree (point) features.'),
  hedgerows: Joi.array()
    .items(postInterventionLinearHabitatSchema)
    .description('Post-intervention hedgerow (linear) features.'),
  watercourses: Joi.array()
    .items(postInterventionWatercourseSchema)
    .description('Post-intervention watercourse (linear) features.'),
  habitatSizes: habitatSizesSummarySchema,
  units: baselineUnitsTotalsSchema
}).description(
  'Imported post-intervention state: features with nested baseline/proposed sub-objects, sizes and unit totals.'
)

export {
  postInterventionDataSchema,
  postInterventionHabitatSchema,
  postInterventionTreeSchema,
  postInterventionLinearHabitatSchema,
  postInterventionWatercourseSchema
}
