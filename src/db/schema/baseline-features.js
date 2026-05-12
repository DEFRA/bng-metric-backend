import { pgSchema, uuid, text } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import { geometry } from './custom-types.js'
import { projects } from './projects.js'

const bng = pgSchema('bng')

const BNG_SRID = 27700

// One red line per project — UNIQUE matches the DB constraint in
// changelog/db.changelog-1.5.xml (changeSet 11). Without this declaration
// drizzle-kit generate would propose dropping the constraint on next sync.
const baselineRedLine = bng.table('baseline_red_line', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  geom: geometry('MultiPolygon', BNG_SRID)('geom').notNull()
})

const baselineHabitats = bng.table('baseline_habitats', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  ref: text('ref'),
  geom: geometry('MultiPolygon', BNG_SRID)('geom').notNull()
})

const baselineHedgerows = bng.table('baseline_hedgerows', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  ref: text('ref'),
  geom: geometry('MultiLineString', BNG_SRID)('geom').notNull()
})

const baselineWatercourses = bng.table('baseline_watercourses', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  ref: text('ref'),
  geom: geometry('MultiLineString', BNG_SRID)('geom').notNull()
})

export {
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses
}
