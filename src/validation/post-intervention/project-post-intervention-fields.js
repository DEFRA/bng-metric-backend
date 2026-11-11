/**
 * Field factories shared by the post-intervention feature schemas. Each
 * habitat keeps its own schema file; this module holds the blocks they all
 * repeat (retention, comment, size, units, and the baseline/proposed sides).
 */
import Joi from 'joi'
import { parentFeatureIdField } from './project-lineage-fields.js'

import { RETENTION_CATEGORY_VALUES } from '../../utilities/enrichment/post-intervention/retention-category.js'
import { featureIdDescription } from '../project-shared-schemas.js'
import { enhancementRulesForLayer } from '../geopackage/post-intervention/enhancement-rules.js'
import { listedFileText, longFileText, shortFileText } from '../text-joi.js'

const DISTINCTIVENESS_SCORE_DESCRIPTION =
  'Numeric distinctiveness score for the band, from bng-library/metric.'
const RETENTION_CATEGORY_DESCRIPTION =
  'Normalised retention category (Retained, Created, or Enhanced) assigned on import from the GeoPackage Retention Category column.'
const POST_INTERVENTION_COMMENT_DESCRIPTION =
  'Free-text comment from the GeoPackage (Comment column on area and tree habitats, Comments on hedgerows and watercourses), with leading and trailing whitespace removed. A legacy file stores it on an Enhanced or Created habitat only: a Retained habitat shares the comment saved on its baseline habitat, and a Lost row keeps its comment on the baseline habitat. A BNG Service template file stores the comment from its Post-Intervention table for every retention category. A blank comment is null.'
const POST_INTERVENTION_STATUS_DESCRIPTION =
  "'Complete' when post-intervention units were successfully calculated; otherwise 'Incomplete'."
const POST_INTERVENTION_STATUS_VALUES = Object.freeze([
  'Complete',
  'Incomplete'
])
const EDITABLE_CREATED_REFERENCE_LAYERS = new Set(['hedgerows', 'watercourses'])

function retentionCategoryField() {
  return {
    retentionCategory: Joi.string()
      .valid(...RETENTION_CATEGORY_VALUES)
      .required()
      .description(RETENTION_CATEGORY_DESCRIPTION)
  }
}

// Set on import only and removed by an edit, so an Enhanced feature imported
// before the check, or one whose enhancement is valid, has no such field.
const INVALID_ENHANCEMENT_DESCRIPTION =
  'The enhancement rule an Enhanced feature broke on import, when its proposed habitat was not a valid enhancement of its baseline: a record of why every proposed attribute was nulled and the feature saved Incomplete, not a check kept current. An edit to the feature removes it (an edit that would break a rule is refused); a later baseline edit leaves it as it was. Absent when the imported enhancement was valid or could not be checked.'

export function invalidEnhancementField(
  layer,
  description = INVALID_ENHANCEMENT_DESCRIPTION
) {
  return {
    invalidEnhancement: Joi.string()
      .valid(...enhancementRulesForLayer(layer))
      .allow(null)
      .description(description)
  }
}

export function baselineCommonFields() {
  return {
    condition: listedFileText('condition').description(
      'Baseline condition assessment stripped of list-index prefix.'
    ),
    conditionScore: Joi.number()
      .allow(null)
      .description(
        'Numeric condition score set during post-intervention enrichment.'
      ),
    distinctiveness: Joi.string()
      .allow(null, '')
      .description('Distinctiveness band resolved by bng-library/metric.'),
    distinctivenessScore: Joi.number()
      .allow(null)
      .description(DISTINCTIVENESS_SCORE_DESCRIPTION)
  }
}

export function proposedCommonFields() {
  return {
    ...baselineCommonFields(),
    condition: listedFileText('condition').description(
      'Proposed condition assessment stripped of list-index prefix.'
    ),
    advanceYears: Joi.number()
      .allow(null)
      .description(
        'Habitat created in advance (years); null when missing, not applicable, conflicting with delay, or redundant for Retained or Lost non-area habitats. Lost area replacement timing follows Created rules.'
      ),
    delayYears: Joi.number()
      .allow(null)
      .description(
        'Delay in starting habitat creation (years); null when missing, not applicable, conflicting with advance, or redundant for Retained or Lost non-area habitats. Lost area replacement timing follows Created rules.'
      ),
    timeMultiplier: Joi.number()
      .allow(null)
      .description(
        'Time multiplier from bng-library/metric; set for Created and Enhanced features.'
      ),
    difficultyMultiplier: Joi.number()
      .allow(null)
      .description(
        'Difficulty multiplier from bng-library/metric; set for Created and Enhanced features.'
      ),
    standardTimeToTargetCondition: Joi.string()
      .allow(null, '')
      .description(
        'Statutory time-to-target years (text) from bng-library/metric before advance/delay; set for Created and Enhanced area features, Created and Enhanced watercourse features, and Enhanced hedgerow features.'
      ),
    difficulty: Joi.string()
      .allow(null, '')
      .description(
        'Difficulty band label (e.g. Low, Medium, High) from the relevant difficulty reference data; set for Created and Enhanced area features, Created and Enhanced watercourse features, and Enhanced hedgerow features.'
      ),
    strategicSignificanceCategory: Joi.string()
      .allow(null, '')
      .description(
        'Strategic significance category (High or Low) the Proposed Strategic Significance resolved to in bng-library/metric; set for Created and Enhanced features, and null where the imported value was not Low or High (BMD-1051).'
      ),
    rejectedStrategicSignificance: shortFileText().description(
      'The Proposed Strategic Significance that was rejected because it was not Low or High (Medium, blank or unrecognised), kept so nulling strategicSignificance loses nothing (BMD-1051). Null when nothing was rejected, or the rejected value was blank; retained on unrelated edits while significance remains unchanged, and cleared when significance changes or a valid value is priced.'
    ),
    strategicSignificanceScore: Joi.number()
      .allow(null)
      .description(
        'Strategic significance multiplier from bng-library/metric (High 1.15, Low 1; Medium is not supported). Applied to Created and Enhanced units; Retained features carry the baseline value, always 1. Null where the imported value was invalid, and the units are then null (BMD-1070).'
      ),
    advanceOrDelay: Joi.string()
      .allow(null, '')
      .description(
        'Advance/delay summary derived from proposed advanceYears and delayYears (e.g. "Advance - 3 years", "Neither").'
      ),
    finalTimeToTargetCondition: Joi.string()
      .allow(null, '')
      .description(
        'Final time-to-target display combining statutory years, advance/delay and time multiplier (e.g. "8 years (0.7)").'
      )
  }
}

// Top-level fields shared by every post-intervention linear feature
// (hedgerows and watercourses): the join key, ref, length/size, units and
// status. `proposed`/`baseline` sub-objects and `properties` are appended
// per feature type.
export function postInterventionLinearFeatureFields({ geometryRow, layer }) {
  const editableCreatedReference = EDITABLE_CREATED_REFERENCE_LAYERS.has(layer)
  return {
    ...retentionCategoryField(),
    ...invalidEnhancementField(layer),
    ...parentFeatureIdField({
      editableCreated: editableCreatedReference
    }),
    ...(editableCreatedReference
      ? {
          referenceEdited: Joi.boolean().description(
            'Whether a Created linear feature reference was edited; its stored parent remains independent of the editable reference.'
          )
        }
      : {}),
    featureId: Joi.string()
      .uuid()
      .required()
      .description(featureIdDescription(geometryRow)),
    ref: shortFileText().description('Feature reference from the GeoPackage.'),
    length: Joi.number()
      .allow(null)
      .description('Length in metres (measured size, rounded), for display.'),
    sizeMetres: Joi.number()
      .allow(null)
      .description(
        'Length in metres, measured from the geometry (bng-library/measure), unrounded. Units are priced on it.'
      ),
    units: Joi.number()
      .allow(null)
      .description(
        'Post-intervention biodiversity units, calculated from proposed values; null when required calculation inputs are missing.'
      ),
    status: Joi.string()
      .valid(...POST_INTERVENTION_STATUS_VALUES)
      .required()
      .description(POST_INTERVENTION_STATUS_DESCRIPTION),
    comment: longFileText().description(POST_INTERVENTION_COMMENT_DESCRIPTION)
  }
}

// Top-level fields shared by every post-intervention area-type feature
// (polygon parcels and individual trees): the join key, ref, area/size, units
// and status. `proposed`/`baseline` sub-objects and `properties` are appended
// per feature type.
export function postInterventionAreaFeatureFields({
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
      .description(featureIdDescription(geometryRow)),
    ref: shortFileText().description(refDescription),
    area: Joi.number().allow(null).description(areaDescription),
    sizeSquareMetres: Joi.number().allow(null).description(sizeDescription),
    units: Joi.number()
      .allow(null)
      .description(
        `${unitsDescription} Null when required calculation inputs are missing at import or recalculation (BMD-1070). Zero, with status Incomplete, when a Created area habitat is saved from its edit form with such an input blank (BMD-1048 AC11). An Incomplete row's zero and null mean the same: it delivers no units and is left out of trading-rule totals.`
      ),
    status: Joi.string()
      .valid(...POST_INTERVENTION_STATUS_VALUES)
      .required()
      .description(POST_INTERVENTION_STATUS_DESCRIPTION),
    comment: longFileText().description(POST_INTERVENTION_COMMENT_DESCRIPTION)
  }
}
