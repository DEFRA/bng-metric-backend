import { describe, expect, it } from 'vitest'
import { PgDialect, QueryBuilder } from 'drizzle-orm/pg-core'

import {
  projectListColumns,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT
} from './project-list.js'
import { projects } from './schema/index.js'

function renderSelect() {
  const query = new QueryBuilder().select(projectListColumns).from(projects)
  return new PgDialect().sqlToQuery(query.getSQL()).sql
}

describe('#projectListColumns', () => {
  it('projects only the columns the list view renders', () => {
    expect(Object.keys(projectListColumns)).toEqual([
      'id',
      'name',
      'hasBaseline',
      'createdAt',
      'updatedAt'
    ])
  })

  // BMD-933: the whole point. Selecting the jsonb column would drag the
  // multi-MB baseline / postIntervention body back per row, per request.
  it('never selects the project document itself', () => {
    const selectList = renderSelect().split(' from ')[0]

    // The bare column, not the `"project"->>'name'` expression built from it.
    expect(selectList).not.toMatch(/(^|[\s,])"project"([\s,]|$)/)
  })

  it('reads the name out of the document rather than the document', () => {
    expect(renderSelect()).toContain(`"project"->>'name' as "name"`)
  })

  it('derives has_baseline with a key-existence test', () => {
    expect(renderSelect()).toContain(
      `jsonb_exists("project", 'baseline') as "has_baseline"`
    )
  })
})

describe('list paging bounds', () => {
  it('defaults to a page small enough to stay flat', () => {
    expect(DEFAULT_LIST_LIMIT).toBe(100)
  })

  it('caps what a caller can ask for', () => {
    expect(MAX_LIST_LIMIT).toBe(500)
    expect(MAX_LIST_LIMIT).toBeGreaterThanOrEqual(DEFAULT_LIST_LIMIT)
  })
})
