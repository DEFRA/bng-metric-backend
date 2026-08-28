// Envelope for the project LIST endpoints.
//
// Deliberately separate from toProjectResponse, which spreads a whole
// bng.projects row: spreading is exactly what shipped the multi-MB `project`
// document to a page that renders three columns (BMD-933). This mapper names
// every field it emits, so a column added to the table — or a key added to the
// document — can never leak into a list response by accident.
//
// The shape stays compatible with the existing consumers: `id` and `projectId`
// as before, timestamps as before, and the name still nested under `project` so
// the list view's `item.project.name` keeps working. `project` here holds the
// projection, not the document — the baseline / postIntervention bodies are not
// read from Postgres at all.

/**
 * @param {object} row a row selected through projectListColumns
 * @returns {object} the list envelope for that row
 */
export function toProjectListResponse(row) {
  return {
    id: row.id,
    projectId: row.id,
    project: { name: row.name },
    // Whether the project has baseline data yet — the frontend uses it to pick
    // each row's link target without needing to look inside the document.
    //
    // snake_case deliberately, against the envelope's camelCase habit: this is
    // the projected `has_baseline` column, and it is the name BMD-933's
    // acceptance criteria and the JMeter suite's AC3 assertion both check for.
    has_baseline: Boolean(row.hasBaseline),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
export function toProjectListResponses(rows) {
  return rows.map(toProjectListResponse)
}
