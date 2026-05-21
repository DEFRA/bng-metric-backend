import Joi from 'joi'

import {
  getAreaBroadHabitats,
  getAreaHabitatTypes,
  getConditionsForHabitatType,
  tradingRulesByDistinctiveness
} from '../validation/baseline/reference/habitat-reference.js'

/**
 * @openapi
 * /reference/broad-habitats:
 *   get:
 *     tags:
 *       - Reference
 *     summary: Broad habitats available in the area-habitats journey
 *     responses:
 *       200:
 *         description: Returns an alphabetical list of broad habitat names
 *
 * /reference/habitat-types:
 *   get:
 *     tags:
 *       - Reference
 *     summary: Habitat types within a broad habitat
 *     parameters:
 *       - in: query
 *         name: broad
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Returns an alphabetical list of habitat type names
 *
 * /reference/conditions:
 *   get:
 *     tags:
 *       - Reference
 *     summary: Condition bands and scores for a habitat type
 *     parameters:
 *       - in: query
 *         name: habitatType
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Returns the condition options in canonical order
 *
 * /reference/trading-rules:
 *   get:
 *     tags:
 *       - Reference
 *     summary: Trading-rule guidance text per distinctiveness band
 *     responses:
 *       200:
 *         description: Returns a map of band to guidance text
 */
const getBroadHabitats = {
  method: 'GET',
  path: '/reference/broad-habitats',
  handler: (_request, _h) => getAreaBroadHabitats()
}

const getHabitatTypes = {
  method: 'GET',
  path: '/reference/habitat-types',
  options: {
    validate: {
      query: Joi.object({
        broad: Joi.string().trim().min(1).required()
      })
    }
  },
  handler: (request, _h) => {
    const { broad } = request.query
    return getAreaHabitatTypes(broad)
  }
}

const getConditions = {
  method: 'GET',
  path: '/reference/conditions',
  options: {
    validate: {
      query: Joi.object({
        habitatType: Joi.string().trim().min(1).required()
      })
    }
  },
  handler: (request, _h) => {
    const { habitatType } = request.query
    return getConditionsForHabitatType(habitatType)
  }
}

const getTradingRules = {
  method: 'GET',
  path: '/reference/trading-rules',
  handler: (_request, _h) => tradingRulesByDistinctiveness
}

export { getBroadHabitats, getHabitatTypes, getConditions, getTradingRules }
