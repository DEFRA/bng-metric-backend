import { pgSchema, uuid, text, integer, jsonb } from 'drizzle-orm/pg-core'

import { geometry } from './custom-types.js'

const bng = pgSchema('bng')

const baselineValidationGeom = bng.table('baseline_validation_geom', {
  runId: uuid('run_id').notNull(),
  layer: text('layer').notNull(),
  featureIdx: integer('feature_idx').notNull(),
  props: jsonb('props').notNull(),
  geom: geometry('Geometry', 27700)('geom').notNull()
})

export { baselineValidationGeom }
