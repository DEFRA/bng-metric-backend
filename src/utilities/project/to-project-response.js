// Surfaces the project's identity on the API response envelope.
//
// The PowerBI / Synapse integration maps our JSON into relational rows, so the
// payload has to name its own primary key. bng.projects.id already is that key
// — it just wasn't labelled as one: `id` alone is ambiguous next to the many
// other ids in the document (featureId, uploadId, relationshipId).
//
// This is deliberately an envelope concern, not a document one. Writing
// projectId into the JSONB would need a backfill migration and a projectSchema
// entry for a field we don't actually persist, and it would break the
// POST/PATCH round-trip: projectSchema rejects unknown keys, so a client
// echoing back a document containing projectId would 400.
//
// The trading-rules statuses ride on the envelope for the same reason. They are
// a pure function of figures the document already carries, so they are derived
// per request rather than stored — no staleness, and no consumer reimplementing
// the rule. Putting them inside `project` would break the same round-trip:
// projectSchema rejects unknown keys, so a client echoing the document back
// would 400.
//
// Additive — `id` is retained, so existing consumers are unaffected.

import { areaTradingRuleStatuses } from './area-trading-rule-statuses.js'

/**
 * @param {object} row a bng.projects row
 * @returns {object} the row with an explicit projectId alias and the derived
 *   trading-rules statuses
 */
export function toProjectResponse(row) {
  return {
    ...row,
    projectId: row.id,
    tradingRuleStatuses: {
      areaHabitats: areaTradingRuleStatuses(row?.project?.postIntervention)
    }
  }
}
