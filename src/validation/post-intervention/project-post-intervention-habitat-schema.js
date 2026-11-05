/**
 * Joi schemas for a post-intervention area habitat and a vertical area
 * habitat. A vertical habitat is an area habitat sized by the face area its
 * own row gives, so the two share the baseline and proposed sub-schemas.
 */
import Joi from 'joi'
import { createdTimingSelectionFields } from './project-timing-fields.js'
import { parentFeatureIdField } from './project-lineage-fields.js'
import {
  baselineCommonFields,
  invalidEnhancementField,
  postInterventionAreaFeatureFields,
  proposedCommonFields
} from './project-post-intervention-fields.js'

import { BASELINE_STRATEGIC_SIGNIFICANCE_DESCRIPTION } from '../project-shared-schemas.js'

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
    .description(BASELINE_STRATEGIC_SIGNIFICANCE_DESCRIPTION)
}).description(
  'Baseline habitat values extracted from the Baseline * GeoPackage columns.'
)

const postInterventionHabitatProposedSubSchema = Joi.object({
  ...createdTimingSelectionFields(),
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

export const postInterventionHabitatSchema = Joi.object({
  ...postInterventionAreaFeatureFields({
    geometryRow: 'bng.post_intervention_habitats',
    refDescription: 'Parcel reference from the GeoPackage (Parcel Ref column).',
    areaDescription:
      'Parcel area in square metres, rounded to the nearest integer, for display.',
    sizeDescription:
      'Parcel area in square metres, measured from the geometry (bng-library/measure), unrounded. Units are priced on it.',
    unitsDescription:
      'Post-intervention biodiversity units for the parcel, calculated from proposed values.'
  }),
  ...invalidEnhancementField('habitats'),
  ...parentFeatureIdField({ editableCreated: true }),
  referenceEdited: Joi.boolean().description(
    'Whether the user changed a Created area reference. Its explicit parentFeatureId is then independent of the editable ref; untouched imported rows retain the existing baseline-ref rename behaviour.'
  ),
  irreplaceable: Joi.boolean().description(
    'Whether the habitat is irreplaceable, from the BNG Service template\'s Irreplaceable Habitat column: true for "Yes", false for "No" or a blank cell (BMD-1083). Absent on a legacy upload, whose template has no such column.'
  ),
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

export const postInterventionVerticalHabitatSchema = Joi.object({
  ...postInterventionAreaFeatureFields({
    geometryRow: 'bng.post_intervention_vertical_habitats',
    refDescription:
      'Habitat reference from the GeoPackage (Habitat Ref column).',
    areaDescription:
      'Face area in square metres, as typed: the same value as sizeSquareMetres, not rounded.',
    sizeDescription:
      "Face area in square metres, as the surveyor estimated it and typed it into the template's Area (m²) column. Units are priced on it, in hectares.",
    unitsDescription:
      'Post-intervention biodiversity units for the vertical area habitat, calculated from proposed values.'
  }),
  ...invalidEnhancementField('verticalHabitats'),
  ...parentFeatureIdField(),
  irreplaceable: Joi.boolean().description(
    'Whether the habitat is irreplaceable, from the BNG Service template\'s Irreplaceable Habitat column: true for "Yes", false for "No" or a blank cell.'
  ),
  baseline: postInterventionHabitatBaselineSubSchema,
  proposed: postInterventionHabitatProposedSubSchema,
  properties: Joi.object()
    .unknown(true)
    .description(
      'Raw attribute columns copied verbatim from the GeoPackage Vertical Area Habitats Post-Intervention layer.'
    )
}).description(
  'A post-intervention vertical area habitat (green wall or intertidal hard structure), drawn as a line along its base, with nested baseline and proposed sub-objects.'
)
