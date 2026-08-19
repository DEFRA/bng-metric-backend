// The column projection every project LIST endpoint selects, and the paging
// bounds that cap how many of those rows a single response can carry.
//
// BMD-933: both list handlers used to `.select()` every column, which pulled the
// whole `project` JSONB document into the response. That document grows with the
// site's feature count (~3 KB/parcel — 6 MB at 2k parcels, 31 MB at 10k), and
// neither dimension of the response was bounded: size = rows x document size.
// A large org listing its projects could therefore materialise hundreds of MB,
// double it again during the synchronous JSON.stringify, and OOM or stall the
// event loop for every other in-flight request on that instance.
//
// The list view needs four fields (name, created/updated timestamps, and whether
// a baseline exists yet, which decides where each row links to), so those are
// the only ones read. Postgres never TOAST-decompresses the document at all,
// because `->>` and `jsonb_exists` are applied to the column but the body is
// never returned.
//
// Deliberately NOT applied to GET /projects/{id} — the single read legitimately
// needs the full document.
import { sql } from 'drizzle-orm'

import { projects } from './schema/index.js'

// Default page size when the caller does not ask for one, and the ceiling the
// caller cannot raise past. Both exist to bound the row-count dimension; without
// a default the endpoint stays unbounded for every existing client.
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 500

// `jsonb_exists(doc, 'baseline')` is the function spelling of the `?` operator.
// Preferred here because `?` is also a placeholder token in several Postgres
// drivers, and the function form reads unambiguously in the generated SQL.
//
// The JS key is camelCase to match the other drizzle field maps; the response
// envelope renames it to `has_baseline` (see to-project-list-response.js), which
// is the name the acceptance criteria and the JMeter suite assert on.
const projectListColumns = {
  id: projects.id,
  name: sql`${projects.project}->>'name'`.as('name'),
  hasBaseline: sql`jsonb_exists(${projects.project}, 'baseline')`.as(
    'has_baseline'
  ),
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt
}

export { projectListColumns, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT }
