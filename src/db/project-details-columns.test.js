import { describe, test, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import {
  projectDetailsColumns,
  projectDetailsReturning
} from './project-details-columns.js'

const render = (column) => new PgDialect().sqlToQuery(column.getSQL())

describe('#projectDetailsColumns', () => {
  test('Should select the project id alongside the details sub-document', () => {
    expect(Object.keys(projectDetailsColumns)).toEqual(['id', 'details'])
  })

  test('Should extract the sub-document in Postgres, not return the body', () => {
    const { sql } = render(projectDetailsColumns.details)

    expect(sql).toContain(`-> 'details'`)
  })
})

describe('#projectDetailsReturning', () => {
  test('Should echo only the merged details back from the write', () => {
    expect(Object.keys(projectDetailsReturning)).toEqual(['details'])
    expect(render(projectDetailsReturning.details).sql).toContain(
      `-> 'details'`
    )
  })
})
