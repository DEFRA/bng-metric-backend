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
// Additive — `id` is retained, so existing consumers are unaffected.

/**
 * @param {object} row a bng.projects row
 * @returns {object} the row with an explicit projectId alias
 */
export function toProjectResponse(row) {
  return { ...row, projectId: row.id }
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
export function toProjectResponses(rows) {
  return rows.map(toProjectResponse)
}
