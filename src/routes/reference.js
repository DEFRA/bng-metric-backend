import { getWatercourseCreationReference } from '../validation/reference/watercourse-creation.js'
import { getHedgerowCreationReference } from '../validation/reference/hedgerow-creation.js'
import Joi from 'joi'
import {
  getAreaCreationReference,
  getTreeCreationReference,
  getTreeEnhancementReference
} from '../validation/reference/area-creation.js'
import { getAreaEnhancementReference } from '../validation/reference/area-enhancement.js'

import { asc } from 'drizzle-orm'
import { localPlanningAuthorities } from '../db/schema/index.js'

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
} from '../validation/reference/habitat-reference.js'

/**
 * @openapi
 * /reference/area-creation:
 *   get:
 *     tags: [Reference]
 *     summary: Area creation habitat types, valid target conditions, difficulty and temporal multipliers
 *     responses:
 *       200:
 *         description: Area-only creation reference data, excluding trees, IGGIs and impossible target conditions
 */
export const getAreaCreation = {
  method: 'GET',
  path: '/reference/area-creation',
  options: { auth: false },
  handler: () => getAreaCreationReference()
}

/**
 * @openapi
 * /reference/tree-creation:
 *   get:
 *     tags: [Reference]
 *     summary: Individual tree creation habitat types, valid target conditions, difficulty and temporal multipliers
 *     responses:
 *       200:
 *         description: The Urban tree and Rural tree creation reference data, shaped as /reference/area-creation is, for the Created tree edit page
 */
export const getTreeCreation = {
  method: 'GET',
  path: '/reference/tree-creation',
  options: { auth: false },
  handler: () => getTreeCreationReference()
}

/**
 * @openapi
 * /reference/tree-enhancement:
 *   get:
 *     tags: [Reference]
 *     summary: Individual tree enhancement target conditions by baseline condition, difficulty and temporal multipliers
 *     responses:
 *       200:
 *         description: The Urban tree and Rural tree enhancement reference data, for the Enhanced tree edit page. Each habitat type gives, under `enhancements`, the target conditions each baseline condition can be enhanced to, with their years to target; strategic significance and time multipliers are shaped as /reference/tree-creation's are
 */
export const getTreeEnhancement = {
  method: 'GET',
  path: '/reference/tree-enhancement',
  options: { auth: false },
  handler: () => getTreeEnhancementReference()
}

// A baseline habitat or condition label, as the area enhancement route takes
// it; blank or absent when the baseline has none.
const MAX_BASELINE_FIELD_LENGTH = 200
const baselineField = Joi.string()
  .max(MAX_BASELINE_FIELD_LENGTH)
  .allow('')
  .optional()

/**
 * @openapi
 * /reference/area-enhancement:
 *   get:
 *     tags: [Reference]
 *     summary: The valid enhancements of a baseline area habitat, with their enhancement difficulty, time to target and temporal multipliers
 *     parameters:
 *       - in: query
 *         name: broadType
 *         schema: { type: string }
 *         description: The baseline habitat's broad habitat
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *         description: The baseline habitat's habitat type
 *       - in: query
 *         name: condition
 *         schema: { type: string }
 *         description: The baseline habitat's condition
 *     responses:
 *       200:
 *         description: |
 *           Shaped as /reference/area-creation, listing only the broad
 *           habitats, habitat types and target conditions that are valid
 *           enhancements of the baseline (BMD-820's rules), each condition
 *           with its enhancement time to target from the baseline. Empty
 *           habitatTypes for a baseline that cannot be enhanced.
 */
export const getAreaEnhancement = {
  method: 'GET',
  path: '/reference/area-enhancement',
  options: {
    auth: false,
    validate: {
      query: Joi.object({
        broadType: baselineField,
        type: baselineField,
        condition: baselineField
      })
    }
  },
  handler: (request) => getAreaEnhancementReference(request.query)
}

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
// (habitat types, conditions, trading rules and LPAs) stored locally,
// with no per-user scope. They opt out of the server's secure-by-default
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

/**
 * @openapi
 * /reference/local-planning-authorities:
 *   get:
 *     tags: [Reference]
 *     summary: Current English Local Planning Authorities, ordered by name
 *     responses:
 *       200:
 *         description: Locally stored Planning Data names and references; no geometry
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 required: [name, reference]
 *                 properties:
 *                   name: { type: string }
 *                   reference: { type: string }
 */
export const getLocalPlanningAuthorities = {
  method: 'GET',
  path: '/reference/local-planning-authorities',
  options: { auth: false },
  handler: (request) =>
    request.drizzle
      .select({
        name: localPlanningAuthorities.name,
        reference: localPlanningAuthorities.reference
      })
      .from(localPlanningAuthorities)
      .orderBy(asc(localPlanningAuthorities.name))
}

/**
 * @openapi
 * /reference/hedgerow-creation:
 *   get:
 *     tags: [Reference]
 *     summary: Hedgerow creation types, valid target conditions, difficulty and temporal multipliers
 *     responses:
 *       200:
 *         description: Hedgerow-only creation reference data
 */
export const getHedgerowCreation = {
  method: 'GET',
  path: '/reference/hedgerow-creation',
  options: { auth: false },
  handler: () => getHedgerowCreationReference()
}

/**
 * @openapi
 * /reference/watercourse-creation:
 *   get:
 *     tags: [Reference]
 *     summary: Watercourse creation types, valid target conditions, difficulty, encroachments and temporal multipliers
 *     responses:
 *       200:
 *         description: Watercourse-only creation reference data
 */
export const getWatercourseCreation = {
  method: 'GET',
  path: '/reference/watercourse-creation',
  options: { auth: false },
  handler: () => getWatercourseCreationReference()
}
