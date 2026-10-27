/**
 * The PostGIS geometry table for each layer of each project document, so the
 * upload that writes geometry rows and the edit that renames them (BMD-1061)
 * agree on where every layer lives.
 */

import {
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses,
  baselineTrees,
  postInterventionRedLine,
  postInterventionHabitats,
  postInterventionHedgerows,
  postInterventionWatercourses,
  postInterventionTrees
} from './schema/index.js'

export const BASELINE_FEATURE_TABLES = Object.freeze({
  redLine: baselineRedLine,
  habitats: baselineHabitats,
  hedgerows: baselineHedgerows,
  watercourses: baselineWatercourses,
  trees: baselineTrees
})

export const POST_INTERVENTION_FEATURE_TABLES = Object.freeze({
  redLine: postInterventionRedLine,
  habitats: postInterventionHabitats,
  hedgerows: postInterventionHedgerows,
  watercourses: postInterventionWatercourses,
  trees: postInterventionTrees
})

export const FEATURE_TABLE_SETS = Object.freeze({
  baseline: BASELINE_FEATURE_TABLES,
  postIntervention: POST_INTERVENTION_FEATURE_TABLES
})
