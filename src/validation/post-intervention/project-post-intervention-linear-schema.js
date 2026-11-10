/**
 * Joi schemas for a post-intervention hedgerow and watercourse. Both are
 * linear features; a watercourse adds the encroachment categories and their
 * multipliers.
 */
import Joi from 'joi'
import { createdTimingSelectionFields } from './project-timing-fields.js'
import {
  baselineCommonFields,
  postInterventionLinearFeatureFields,
  proposedCommonFields
} from './project-post-intervention-fields.js'

import { BASELINE_STRATEGIC_SIGNIFICANCE_DESCRIPTION } from '../project-shared-schemas.js'

const postInterventionLinearBaselineSubSchema = Joi.object({
  type: Joi.string()
    .allow(null, '')
    .description('Baseline hedgerow type from Baseline Hedge Type column.'),
  ...baselineCommonFields(),
  strategicSignificance: Joi.string()
    .allow(null, '')
    .description(BASELINE_STRATEGIC_SIGNIFICANCE_DESCRIPTION)
}).description(
  'Baseline hedgerow values from the Baseline * GeoPackage columns.'
)

const postInterventionLinearProposedSubSchema = Joi.object({
  ...createdTimingSelectionFields(),
  type: Joi.string()
    .allow(null, '')
    .description('Proposed hedgerow type from Proposed Hedge Type column.'),
  ...proposedCommonFields(),
  strategicSignificance: Joi.string()
    .allow(null, '')
    .description('Proposed Strategic Significance from the GeoPackage.')
}).description(
  'Proposed hedgerow values from the Proposed * GeoPackage columns.'
)

export const postInterventionLinearHabitatSchema = Joi.object({
  ...postInterventionLinearFeatureFields({
    geometryRow: 'bng.post_intervention_hedgerows',
    layer: 'hedgerows'
  }),
  baseline: postInterventionLinearBaselineSubSchema,
  proposed: postInterventionLinearProposedSubSchema,
  properties: Joi.object()
    .unknown(true)
    .description(
      'Raw attribute columns copied verbatim from the GeoPackage Hedgerows layer.'
    )
}).description('A post-intervention hedgerow (linear) feature.')

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
      'Watercourse-encroachment multiplier applied by bng-library/metric when computing units.'
    ),
  riparianEncroachmentMultiplier: Joi.number()
    .allow(null)
    .description(
      'Riparian-encroachment multiplier applied by bng-library/metric when computing units.'
    )
}

export const postInterventionWatercourseSchema = Joi.object({
  editedAdvanceYears: Joi.number()
    .allow(null)
    .description(
      'Advance years explicitly saved by a Created watercourse edit, including null when cleared. Takes precedence over the raw uploaded advance when lineage is recalculated.'
    ),
  ...postInterventionLinearFeatureFields({
    geometryRow: 'bng.post_intervention_watercourses',
    layer: 'watercourses'
  }),
  baseline: Joi.object({
    type: Joi.string()
      .allow(null, '')
      .description(
        'Baseline watercourse type from Baseline River Type column.'
      ),
    ...baselineCommonFields(),
    ...watercourseEncroachmentFields,
    strategicSignificance: Joi.string()
      .allow(null, '')
      .description(BASELINE_STRATEGIC_SIGNIFICANCE_DESCRIPTION)
  }).description(
    'Baseline watercourse values from the Baseline * GeoPackage columns.'
  ),
  proposed: Joi.object({
    ...createdTimingSelectionFields(),
    type: Joi.string()
      .allow(null, '')
      .description(
        'Proposed watercourse type from Proposed River Type column.'
      ),
    ...proposedCommonFields(),
    ...watercourseEncroachmentFields
  }).description(
    'Proposed watercourse values from the Proposed * GeoPackage columns.'
  ),
  properties: Joi.object()
    .unknown(true)
    .description(
      'Raw attribute columns copied verbatim from the GeoPackage Watercourses layer.'
    )
}).description('A post-intervention watercourse (linear) feature.')
