/**
 * Joi validation schema for the baseline habitats a BNG Service template
 * upload loses, stored in `project.postIntervention.lostHabitats`.
 *
 * Composed into postInterventionDataSchema by
 * project-post-intervention-schema.js, and used directly by persist-project.js
 * to validate the fragment it writes.
 */
import Joi from 'joi'

// Set on a BNG Service template upload only (BMD-1083), from its parent links.
const lostHabitatSchema = Joi.object({
  layer: Joi.string()
    .valid('habitats', 'verticalHabitats', 'hedgerows', 'watercourses', 'trees')
    .required()
    .description('The baseline layer the lost habitat is in.'),
  featureId: Joi.string()
    .uuid()
    .required()
    .description('The featureId of the lost baseline feature.'),
  ref: Joi.string()
    .allow(null)
    .description('The Habitat Ref of the lost baseline feature.'),
  type: Joi.string()
    .allow(null)
    .description('The habitat type of the lost baseline feature.'),
  outcome: Joi.string()
    .valid('removed', 'lostAndRecreated', 'lost')
    .required()
    .description(
      'How it is lost: `removed` when no post-intervention habitat names it; `lostAndRecreated` when a Created habitat of its own type names it (a habitat that gets worse, recorded as lost and created again); `lost` when it is lost, in full or in part, to creations of another type or to nothing.'
    ),
  lostSizeSquareMetres: Joi.number()
    .min(0)
    .description(
      "An area habitat, vertical area habitat or tree: its area less that of its Retained and Enhanced post-intervention habitats, in square metres. A tree's area is the tree helper's area for its size class times its Count."
    ),
  lostTreeCount: Joi.number()
    .integer()
    .min(0)
    .description(
      'A tree: its Count less that of its Retained and Enhanced post-intervention trees, the number of trees lost. A blank Count is one tree.'
    ),
  lostSizeMetres: Joi.number()
    .min(0)
    .description(
      'A hedgerow or watercourse: its length less that of its Retained and Enhanced post-intervention habitats, in metres.'
    ),
  recreatedAs: Joi.array()
    .items(Joi.string().uuid())
    .description(
      'The featureIds of the Created post-intervention habitats of its own type that re-create it. Empty unless `outcome` is `lostAndRecreated`.'
    )
}).description(
  'A baseline habitat a BNG Service template upload loses, in full or in part.'
)

const lostHabitatsSchema = Joi.array()
  .items(lostHabitatSchema)
  .description(
    'The baseline habitats a BNG Service template upload loses, in full or in part, worked out from its parent links when it is imported, and again when a baseline edit re-derives this document or a post-intervention edit changes a habitat (BMD-1083). Absent on a legacy upload.'
  )

export { lostHabitatsSchema }
