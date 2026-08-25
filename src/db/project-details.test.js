import { describe, test, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import {
  projectDetailsColumns,
  projectDetailsReturning
} from './project-details.js'

const render = (column) => new PgDialect().sqlToQuery(column.getSQL())

describe('#projectDetailsColumns', () => {
  test('Should select the project id alongside the details sub-document', () => {
    expect(Object.keys(projectDetailsColumns)).toEqual(['id', 'details'])
  })

  test('Should extract the sub-document in Postgres, not return the body', () => {
    const { sql } = render(projectDetailsColumns.details)

    expect(sql).toContain(`-> 'details'`)
    // The document itself is never part of the projection: only the arrow
    // expression applied to the column.
    expect(sql).not.toMatch(/^"bng"\."projects"\."project"$/)
  })
})

describe('#projectDetailsReturning', () => {
  test('Should echo only the merged details back from the write', () => {
    expect(Object.keys(projectDetailsReturning)).toEqual(['details'])
    expect(render(projectDetailsReturning.details).sql).toContain(
      `-> 'details'`
    )
  })

  test('Should be a distinct expression from the read projection', () => {
    // Separate instances, so neither query can be affected by the other.
    expect(projectDetailsReturning.details).not.toBe(
      projectDetailsColumns.details
    )
  })
})
