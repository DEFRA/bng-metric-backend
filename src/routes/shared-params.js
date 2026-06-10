import Joi from 'joi'

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
 * The two encroachment fields only apply to watercourse features; the area
 * and hedgerow forms never submit them. They live on the shared schema rather
 * than a watercourse-specific one because the frontend POSTs every save
 * through a single endpoint and the backend dispatches by feature type.
 */
export const featureEditPayload = Joi.object({
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
