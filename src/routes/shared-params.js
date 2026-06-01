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
