import Joi from 'joi'

import {
  getAreaBroadHabitats,
  getAreaHabitatTypes,
  getAreaHabitatTypesByBroad,
  getConditionsForHabitatType,
  getConditionsForHedgerowType,
  getConditionsForWatercourseType,
  getHedgerowHabitatTypes,
  getRiparianEncroachmentOptions,
  getWatercourseEncroachmentOptions,
  getWatercourseHabitatTypes,
  tradingRulesByDistinctiveness,
  watercourseTradingRulesByDistinctiveness
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
 *           enum: [habitat, hedgerow, watercourse]
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
 * /reference/watercourse-types:
 *   get:
 *     tags:
 *       - Reference
 *     summary: Watercourse habitat types available in the watercourse journey
 *     description: |
 *       Returns the engine's watercourse habitat types sorted alphabetically,
 *       each with its distinctiveness band + score. Filtered to the in-scope
 *       bands (Low / Medium); High and V.High are excluded because they are out
 *       of scope for the BNG Beta service and are rejected at upload.
 *     responses:
 *       200:
 *         description: Alphabetical list of watercourse habitat types
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
 * /reference/watercourse-encroachments:
 *   get:
 *     tags:
 *       - Reference
 *     summary: Watercourse + riparian encroachment dropdown options
 *     description: |
 *       Returns both encroachment lists in one response so the watercourse
 *       details page only needs one round trip for them. Each list is in the
 *       engine's canonical authored order.
 *     responses:
 *       200:
 *         description: Map of encroachment dropdown to option list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 watercourse:
 *                   type: array
 *                   items: { type: string }
 *                 riparian:
 *                   type: array
 *                   items: { type: string }
 *
 * /reference/trading-rules:
 *   get:
 *     tags:
 *       - Reference
 *     summary: Trading-rule guidance text per distinctiveness band
 *     parameters:
 *       - in: query
 *         name: featureType
 *         required: false
 *         schema:
 *           type: string
 *           enum: [habitat, hedgerow, watercourse]
 *           default: habitat
 *         description: |
 *           Which feature's trading-rules wording to return. Area and hedgerow
 *           share the area distinctiveness table; watercourse has its own at
 *           V.High.
 *     responses:
 *       200:
 *         description: Returns a map of band to guidance text
 */
// All /reference/* routes are public (PUBLIC_ROUTES): static lookup data
// (habitat types, conditions, trading rules) bundled into the engine at build
// time, with no per-user scope. They opt out of the server's secure-by-default
// auth strategy with `auth: false`. See docs/auth-route-policy.md.
const getBroadHabitats = {
  method: 'GET',
  path: '/reference/broad-habitats',
  options: { auth: false },
  handler: (_request, _h) => getAreaBroadHabitats()
}

const getHabitatTypes = {
  method: 'GET',
  path: '/reference/habitat-types',
  options: {
    auth: false,
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
  options: { auth: false },
  handler: (_request, _h) => getAreaHabitatTypesByBroad()
}

const CONDITION_LOOKUPS = {
  habitat: getConditionsForHabitatType,
  hedgerow: getConditionsForHedgerowType,
  watercourse: getConditionsForWatercourseType
}

const getConditions = {
  method: 'GET',
  path: '/reference/conditions',
  options: {
    auth: false,
    validate: {
      query: Joi.object({
        habitatType: Joi.string().trim().min(1).required(),
        featureType: Joi.string()
          .valid('habitat', 'hedgerow', 'watercourse')
          .default('habitat')
      })
    }
  },
  handler: (request, _h) => {
    const { habitatType, featureType = 'habitat' } = request.query
    return CONDITION_LOOKUPS[featureType](habitatType)
  }
}

const getHedgerowTypes = {
  method: 'GET',
  path: '/reference/hedgerow-types',
  options: { auth: false },
  handler: (_request, _h) => getHedgerowHabitatTypes()
}

const getWatercourseTypes = {
  method: 'GET',
  path: '/reference/watercourse-types',
  options: { auth: false },
  handler: (_request, _h) => getWatercourseHabitatTypes()
}

// One endpoint returns both encroachment lists so the watercourse strategy can
// fetch its static reference slice in a single round trip rather than two.
const getWatercourseEncroachments = {
  method: 'GET',
  path: '/reference/watercourse-encroachments',
  options: { auth: false },
  handler: (_request, _h) => ({
    watercourse: getWatercourseEncroachmentOptions(),
    riparian: getRiparianEncroachmentOptions()
  })
}

const TRADING_RULES_BY_FEATURE_TYPE = {
  habitat: tradingRulesByDistinctiveness,
  hedgerow: tradingRulesByDistinctiveness,
  watercourse: watercourseTradingRulesByDistinctiveness
}

const getTradingRules = {
  method: 'GET',
  path: '/reference/trading-rules',
  options: {
    auth: false,
    validate: {
      query: Joi.object({
        featureType: Joi.string()
          .valid('habitat', 'hedgerow', 'watercourse')
          .default('habitat')
      })
    }
  },
  handler: (request, _h) => {
    const featureType = request.query?.featureType ?? 'habitat'
    return TRADING_RULES_BY_FEATURE_TYPE[featureType]
  }
}

export {
  getBroadHabitats,
  getHabitatTypes,
  getHabitatTypesByBroad,
  getConditions,
  getHedgerowTypes,
  getWatercourseTypes,
  getWatercourseEncroachments,
  getTradingRules
}
