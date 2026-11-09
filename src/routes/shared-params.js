import Joi from 'joi'

import {
  MAX_HABITAT_REF_LENGTH,
  hasInvalidRefCharacters,
  isHabitatRefTooLong
} from '../validation/geopackage/habitat-ref-check.js'
import {
  SHORT_TEXT_LIMIT,
  characterCount
} from '../validation/geopackage/text-limits.js'

/**
 * Joi validator for routes whose path takes both a project UUID and a
 * feature UUID. Shared so individual routes don't repeat the schema.
 */
export const projectFeatureIdParams = Joi.object({
  projectId: Joi.string().uuid().required(),
  featureId: Joi.string().uuid().required()
})

/**
 * A drop-down choice sent from an edit page: optional, blankable, and no
 * longer than a drop-down column of an upload (BMD-1175), counted in
 * characters. Whether it is a choice the page offers is checked later,
 * against the reference data.
 */
function dropDownChoice() {
  return Joi.string()
    .trim()
    .allow(null, '')
    .custom((value, helpers) =>
      characterCount(value) > SHORT_TEXT_LIMIT
        ? helpers.error('string.tooManyCharacters')
        : value
    )
    .messages({
      'string.tooManyCharacters': `{{#label}} must be ${SHORT_TEXT_LIMIT} characters or fewer`
    })
    .optional()
}

/**
 * Joi validator for the editable baseline-feature attributes accepted by the
 * area-habitat and feature PUT endpoints. Shared so both routes validate the
 * same shape.
 *
 * `ref` is only acted on by the unified feature PUT; the legacy area-habitat
 * route reads the dropdown fields alone and forbids it (habitats.js).
 *
 * The two encroachment fields only apply to watercourse features; the area
 * and hedgerow forms never submit them. They live on the shared schema rather
 * than a watercourse-specific one because the frontend POSTs every save
 * through a single endpoint and the backend dispatches by feature type.
 */
export const featureEditPayload = Joi.object({
  // The habitat's Parcel Ref (BMD-1061). Optional: a save that leaves it out
  // keeps the stored ref. When sent it follows the import rules (BMD-1058,
  // BMD-1175): blank or whitespace-only is refused, so is text that is not
  // valid UTF-8, and so is a ref over 99 characters.
  ref: Joi.string()
    .trim()
    .custom((value, helpers) => {
      if (hasInvalidRefCharacters(value)) {
        return helpers.error('string.invalidRef')
      }
      return isHabitatRefTooLong(value)
        ? helpers.error('string.refTooLong')
        : value
    })
    .messages({
      'string.invalidRef':
        '{{#label}} contains characters that are not valid UTF-8',
      'string.refTooLong': `{{#label}} must be ${MAX_HABITAT_REF_LENGTH} characters or fewer`
    })
    .optional(),
  broadType: dropDownChoice(),
  habitatType: dropDownChoice(),
  condition: dropDownChoice(),
  watercourseEncroachment: dropDownChoice(),
  riparianEncroachment: dropDownChoice()
})

/**
 * Joi validator for a post-intervention reference edit (BMD-1180): the
 * habitat reference alone, required, with the same rules as the baseline one.
 */
export const retainedRefEditPayload = Joi.object({
  ref: featureEditPayload.extract('ref').required()
})

/**
 * @openapi
 * components:
 *   parameters:
 *     ProjectId:
 *       in: path
 *       name: projectId
 *       required: true
 *       schema:
 *         type: string
 *         format: uuid
 *     FeatureId:
 *       in: path
 *       name: featureId
 *       required: true
 *       schema:
 *         type: string
 *         format: uuid
 */
