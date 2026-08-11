import { pgSchema, uuid, text } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import { geometry } from './custom-types.js'
import { projects } from './projects.js'

const bng = pgSchema('bng')

const BNG_SRID = 27700

const postInterventionRedLine = bng.table('post_intervention_red_line', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  geom: geometry('MultiPolygon', BNG_SRID)('geom').notNull()
})

const postInterventionHabitats = bng.table('post_intervention_habitats', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  ref: text('ref'),
  geom: geometry('MultiPolygon', BNG_SRID)('geom').notNull()
})

const postInterventionHedgerows = bng.table('post_intervention_hedgerows', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  ref: text('ref'),
  geom: geometry('MultiLineString', BNG_SRID)('geom').notNull()
})

const postInterventionWatercourses = bng.table(
  'post_intervention_watercourses',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ref: text('ref'),
    geom: geometry('MultiLineString', BNG_SRID)('geom').notNull()
  }
)

const postInterventionTrees = bng.table('post_intervention_trees', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  ref: text('ref'),
  geom: geometry('MultiPoint', BNG_SRID)('geom').notNull()
})

export {
  postInterventionRedLine,
  postInterventionHabitats,
  postInterventionHedgerows,
  postInterventionWatercourses,
  postInterventionTrees
}
