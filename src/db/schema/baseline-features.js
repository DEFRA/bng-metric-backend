import { pgSchema, uuid, text } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import { geometry } from './custom-types.js'

const bng = pgSchema('bng')

const baselineRedLine = bng.table('baseline_red_line', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id').notNull(),
  geom: geometry('MultiPolygon', 27700)('geom').notNull()
})

const baselineHabitats = bng.table('baseline_habitats', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id').notNull(),
  ref: text('ref'),
  geom: geometry('MultiPolygon', 27700)('geom').notNull()
})

const baselineHedgerows = bng.table('baseline_hedgerows', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id').notNull(),
  ref: text('ref'),
  geom: geometry('MultiLineString', 27700)('geom').notNull()
})

const baselineWatercourses = bng.table('baseline_watercourses', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id').notNull(),
  ref: text('ref'),
  geom: geometry('MultiLineString', 27700)('geom').notNull()
})

export {
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses
}
