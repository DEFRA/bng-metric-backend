// The projection both `details` endpoints use, so that reading or echoing a
// handful of fields does not move the whole project document.
//
// GET /projects/{id}/details selected every column, shipped the entire project
// JSONB across the wire and parsed it, only to return `project.details` — the
// same shape of waste BMD-933 removed from the list endpoints and the by-id
// feature reads (see src/db/project-features.js). The PATCH beside it had the
// write half right already (a surgical jsonb_set) but returned the whole
// updated row just to echo the details back.
//
// `-> 'details'` is applied to the column without the body being returned, so
// the sub-document is all that crosses the wire in either direction.
import { sql } from 'drizzle-orm'

import { projects } from './schema/index.js'

/**
 * The `details` sub-document, extracted by Postgres. Built per call so the read
 * and write maps below each hold their own expression.
 */
function detailsColumn() {
  return sql`${projects.project} -> 'details'`.as('details')
}

/**
 * Select map for the details read. `id` is selected too, so a visible project
 * still returns a row when it carries no details yet and the 404 stays
 * distinguishable from an empty result.
 */
const projectDetailsColumns = { id: projects.id, details: detailsColumn() }

/** Returning map for the details write, which echoes the merged details back. */
const projectDetailsReturning = { details: detailsColumn() }

export { projectDetailsColumns, projectDetailsReturning }
