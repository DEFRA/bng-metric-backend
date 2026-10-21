import Joi from 'joi'

import { hasInvalidRefCharacters } from '../validation/geopackage/habitat-ref-check.js'

/**
 * Joi validator for routes whose path takes both a project UUID and a
 * feature UUID. Shared so individual routes don't repeat the schema.
 */
export const projectFeatureIdParams = Joi.object({
  projectId: Joi.string().uuid().required(),
  featureId: Joi.string().uuid().required()
})

/**
 * Joi validator for the editable baseline-feature attributes accepted by the
 * area-habitat and feature PUT endpoints. Shared so both routes validate the
 * same shape.
 *
 * `ref` is only acted on by the unified feature PUT; the legacy area-habitat
 * route reads the dropdown fields alone.
 *
 * The two encroachment fields only apply to watercourse features; the area
 * and hedgerow forms never submit them. They live on the shared schema rather
 * than a watercourse-specific one because the frontend POSTs every save
 * through a single endpoint and the backend dispatches by feature type.
 */
export const featureEditPayload = Joi.object({
  // The habitat's Parcel Ref (BMD-1061). Optional: a save that leaves it out
  // keeps the stored ref. When sent it follows the import rules (BMD-1058):
  // blank or whitespace-only is refused, so is text that is not valid UTF-8,
  // and a ref over the length limit is truncated on save, not refused
  // (cleanHabitatRef in apply-feature-update.js).
  ref: Joi.string()
    .trim()
    .custom((value, helpers) =>
      hasInvalidRefCharacters(value)
        ? helpers.error('string.invalidRef')
        : value
    )
    .messages({
      'string.invalidRef':
        '{{#label}} contains characters that are not valid UTF-8'
    })
    .optional(),
  broadType: Joi.string().trim().allow(null, '').optional(),
  habitatType: Joi.string().trim().allow(null, '').optional(),
  condition: Joi.string().trim().allow(null, '').optional(),
  watercourseEncroachment: Joi.string().trim().allow(null, '').optional(),
  riparianEncroachment: Joi.string().trim().allow(null, '').optional()
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
