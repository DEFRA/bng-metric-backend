/**
 * Joi validation schema for the post-intervention state stored in
 * `project.postIntervention`. Each feature family has its own schema file;
 * this module assembles them into the document schema.
 *
 * Imported by project.js and consumed by the route validation in baseline.js.
 */
import Joi from 'joi'
import {
  habitatSizesSummarySchema,
  baselineUnitsTotalsSchema,
  redLineSchema,
  featureDataEnvelopeFields
} from '../project-shared-schemas.js'
import { tradingRulesSchema } from './trading-rules-schema.js'
import { lostHabitatsSchema } from './lost-habitats-schema.js'
import {
  postInterventionHabitatSchema,
  postInterventionVerticalHabitatSchema
} from './project-post-intervention-habitat-schema.js'
import { postInterventionTreeSchema } from './project-post-intervention-tree-schema.js'
import {
  postInterventionLinearHabitatSchema,
  postInterventionWatercourseSchema
} from './project-post-intervention-linear-schema.js'

const postInterventionDataSchema = Joi.object({
  ...featureDataEnvelopeFields,
  redLine: redLineSchema,
  habitats: Joi.array()
    .items(postInterventionHabitatSchema)
    .description('Post-intervention area (polygon) habitat parcels.'),
  trees: Joi.array()
    .items(postInterventionTreeSchema)
    .description('Post-intervention individual tree (point) features.'),
  verticalHabitats: Joi.array()
    .items(postInterventionVerticalHabitatSchema)
    .description(
      'Post-intervention vertical area habitats (green walls and intertidal hard structures). Read from a BNG Service template file only: empty for a legacy upload, and absent on a document saved before vertical area habitats were read.'
    ),
  hedgerows: Joi.array()
    .items(postInterventionLinearHabitatSchema)
    .description('Post-intervention hedgerow (linear) features.'),
  watercourses: Joi.array()
    .items(postInterventionWatercourseSchema)
    .description('Post-intervention watercourse (linear) features.'),
  habitatSizes: habitatSizesSummarySchema,
  units: baselineUnitsTotalsSchema,
  tradingRules: tradingRulesSchema,
  lostHabitats: lostHabitatsSchema
}).description(
  'Imported post-intervention state: features with nested baseline/proposed sub-objects, sizes, unit totals and trading-rules unit figures.'
)

export {
  postInterventionDataSchema,
  tradingRulesSchema,
  lostHabitatsSchema,
  postInterventionHabitatSchema,
  postInterventionTreeSchema,
  postInterventionVerticalHabitatSchema,
  postInterventionLinearHabitatSchema,
  postInterventionWatercourseSchema
}
