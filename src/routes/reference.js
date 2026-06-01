import Joi from 'joi'

import {
  getAreaBroadHabitats,
  getAreaHabitatTypes,
  getAreaHabitatTypesByBroad,
  getConditionsForHabitatType,
  getConditionsForHedgerowType,
  getHedgerowHabitatTypes,
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
 *         description: |
 *           Returns the alphabetical list of habitat types for the broad,
 *           each with its distinctiveness band and score.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name: { type: string }
 *                   distinctiveness: { type: string }
 *                   distinctivenessScore: { type: number }
 *
 * /reference/habitat-types-by-broad:
 *   get:
 *     tags:
 *       - Reference
 *     summary: Every area habitat type grouped by broad habitat
 *     description: |
 *       Returns the full lookup table in one response. The BMD-480 client-side
 *       dropdown JS uses this to repopulate the habitat-type dropdown on broad
 *       change and to look up distinctiveness band/score on habitat-type
 *       change, without a per-broad round trip.
 *     responses:
 *       200:
 *         description: Map of broad name to habitat-type entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name: { type: string }
 *                     distinctiveness: { type: string }
 *                     distinctivenessScore: { type: number }
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
 *       - in: query
 *         name: featureType
 *         required: false
 *         schema:
 *           type: string
 *           enum: [habitat, hedgerow]
 *           default: habitat
 *         description: Which reference table to look up. Defaults to area habitats.
 *     responses:
 *       200:
 *         description: Returns the condition options in canonical order
 *
 * /reference/hedgerow-types:
 *   get:
 *     tags:
 *       - Reference
 *     summary: Hedgerow habitat types available in the hedgerow journey
 *     description: |
 *       Returns the MVS-scope (V.Low / Low / Medium) hedgerow habitat types in
 *       alphabetical order, each with its distinctiveness band + score. Used
 *       by the BMD-500 hedgerow details page to populate the habitat-type
 *       dropdown and supply distinctiveness data for client-side rendering.
 *     responses:
 *       200:
 *         description: Alphabetical list of hedgerow habitat types
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name: { type: string }
 *                   distinctiveness: { type: string }
 *                   distinctivenessScore: { type: number }
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

const getHabitatTypesByBroad = {
  method: 'GET',
  path: '/reference/habitat-types-by-broad',
  handler: (_request, _h) => getAreaHabitatTypesByBroad()
}

const getConditions = {
  method: 'GET',
  path: '/reference/conditions',
  options: {
    validate: {
      query: Joi.object({
        habitatType: Joi.string().trim().min(1).required(),
        featureType: Joi.string()
          .valid('habitat', 'hedgerow')
          .default('habitat')
      })
    }
  },
  handler: (request, _h) => {
    const { habitatType, featureType } = request.query
    return featureType === 'hedgerow'
      ? getConditionsForHedgerowType(habitatType)
      : getConditionsForHabitatType(habitatType)
  }
}

const getHedgerowTypes = {
  method: 'GET',
  path: '/reference/hedgerow-types',
  handler: (_request, _h) => getHedgerowHabitatTypes()
}

const getTradingRules = {
  method: 'GET',
  path: '/reference/trading-rules',
  handler: (_request, _h) => tradingRulesByDistinctiveness
}

export {
  getBroadHabitats,
  getHabitatTypes,
  getHabitatTypesByBroad,
  getConditions,
  getHedgerowTypes,
  getTradingRules
}
