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

import { RETENTION_CATEGORY_VALUES } from '../utilities/baseline/retention-category.js'
import {
  habitatSizesSummarySchema,
  baselineUnitsTotalsSchema,
  redLineSchema,
  featureDataEnvelopeFields
} from './project-shared-schemas.js'

const DISTINCTIVENESS_SCORE_DESCRIPTION =
  'Numeric distinctiveness score for the band, from bng-metric-engine.'
const RETENTION_CATEGORY_DESCRIPTION =
  'Normalised retention category (Retained, Created, or Enhanced) assigned on import from the GeoPackage Retention Category column.'
const POST_INTERVENTION_STATUS_DESCRIPTION =
  "'Complete' when post-intervention units were successfully calculated; otherwise 'Incomplete'."
const POST_INTERVENTION_STATUS_VALUES = Object.freeze([
  'Complete',
  'Incomplete'
])

// ──────────────────────────────────────────────────────────────────────────────
// Shared sub-object factories
// ──────────────────────────────────────────────────────────────────────────────

function retentionCategoryField() {
  return {
    retentionCategory: Joi.string()
      .valid(...RETENTION_CATEGORY_VALUES)
      .required()
      .description(RETENTION_CATEGORY_DESCRIPTION)
  }
}

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
    condition: Joi.string()
      .allow(null, '')
      .description(
        'Proposed condition assessment stripped of list-index prefix.'
      ),
    advanceYears: Joi.number()
      .allow(null)
      .description(
        'Habitat created in advance (years) from the GeoPackage; null when the column is N/A (typical for Lost features).'
      ),
    delayYears: Joi.number()
      .allow(null)
      .description(
        'Delay in starting habitat creation (years) from the GeoPackage; null when the column is N/A (typical for Lost features).'
      ),
    timeMultiplier: Joi.number()
      .allow(null)
      .description(
        'Time multiplier from bng-metric-engine; set for Created and Enhanced features.'
      ),
    difficultyMultiplier: Joi.number()
      .allow(null)
      .description(
        'Difficulty multiplier from bng-metric-engine; set for Created and Enhanced features.'
      ),
    standardTimeToTargetCondition: Joi.string()
      .allow(null, '')
      .description(
        'Statutory time-to-target years (text) from bng-metric-engine before advance/delay; set for Enhanced area features.'
      ),
    difficulty: Joi.string()
      .allow(null, '')
      .description(
        'Difficulty band label (e.g. Low, Medium, High) from habitat-area-difficulty.json; set for Enhanced area features.'
      ),
    advanceOrDelay: Joi.string()
      .allow(null, '')
      .description(
        'Advance/delay summary derived from proposed advanceYears and delayYears (e.g. "Advance - 3 years", "Neither").'
      ),
    finalTimeToTargetCondition: Joi.string()
      .allow(null, '')
      .description(
        'Final time-to-target display combining statutory years and time multiplier (e.g. "10 years (0.7)").'
      )
  }
}

// Top-level fields shared by every post-intervention linear feature
// (hedgerows and watercourses): the join key, ref, length/size, units and
// status. `proposed`/`baseline` sub-objects and `properties` are appended
// per feature type.
function postInterventionLinearFeatureFields({ geometryRow }) {
  return {
    ...retentionCategoryField(),
    featureId: Joi.string()
      .uuid()
      .required()
      .description(
        `UUID assigned on import; join key to the ${geometryRow} geometry row.`
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
      .valid(...POST_INTERVENTION_STATUS_VALUES)
      .required()
      .description(POST_INTERVENTION_STATUS_DESCRIPTION)
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
    ...retentionCategoryField(),
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
      .valid(...POST_INTERVENTION_STATUS_VALUES)
      .required()
      .description(POST_INTERVENTION_STATUS_DESCRIPTION)
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
    .description('Baseline Strategic Significance from the GeoPackage.')
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
  ...treeSideCommonFields()
}).description(
  'Baseline individual-tree values from the Baseline * GeoPackage columns.'
)

const postInterventionTreeProposedSubSchema = Joi.object({
  ...treeSideCommonFields(),
  // Trees enrich via the area-habitat path, so a Created or Enhanced tree
  // carries the same proposed-side fields (condition, advance/delay years and
  // the engine time/difficulty multipliers) as an area parcel. Reuse the shared
  // factory so any future engine field flows to trees automatically — omitting
  // one previously caused persistence to reject non-retained trees.
  ...proposedCommonFields()
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
  ...postInterventionLinearFeatureFields({
    geometryRow: 'bng.baseline_hedgerows'
  }),
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
  ...postInterventionLinearFeatureFields({
    geometryRow: 'bng.baseline_watercourses'
  }),
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
