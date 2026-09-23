import { describe, expect, it } from 'vitest'
import { pgSchema, text, unique as uniqueConstraint } from 'drizzle-orm/pg-core'
import { describeTable, renderPostgresSection } from './gen-data-dictionary.js'
import { loginAudit, relationships, roles } from '../src/db/schema/index.js'

const quotedColumnList = (columns) =>
  columns.map((column) => `\`${column}\``).join(', ')

describe('data dictionary uniqueness', () => {
  it.each([
    [
      loginAudit,
      'uq_login_audit_session_relationship',
      ['session_id', 'current_relationship_id']
    ],
    [
      relationships,
      'uq_relationships_user_rel',
      ['user_id', 'relationship_id']
    ],
    [roles, 'uq_roles_user_rel_name', ['user_id', 'relationship_id', 'name']]
  ])(
    'describes a composite unique once, without marking its columns independently unique',
    (schema, name, constraintColumns) => {
      const dictionaryTable = describeTable(schema)
      expect(dictionaryTable.compositeUniques).toEqual([
        { name, columns: constraintColumns }
      ])
      for (const column of constraintColumns) {
        expect(
          dictionaryTable.columns.find((entry) => entry.name === column).unique
        ).toBe(false)
      }
      const markdown = renderPostgresSection([dictionaryTable])
      expect(markdown).toContain(
        `UNIQUE (${quotedColumnList(constraintColumns)})`
      )
      expect(markdown).toContain(`\`${name}\``)
    }
  )

  it('retains true single-column unique flags', () => {
    const schema = pgSchema('example').table(
      'single_unique',
      {
        inline: text('inline').unique(),
        named: text('named'),
        ordinary: text('ordinary')
      },
      (schemaTable) => [uniqueConstraint('uq_named').on(schemaTable.named)]
    )
    const dictionaryTable = describeTable(schema)
    expect(
      dictionaryTable.columns.map(({ name, unique }) => ({ name, unique }))
    ).toEqual([
      { name: 'inline', unique: true },
      { name: 'named', unique: true },
      { name: 'ordinary', unique: false }
    ])
    expect(dictionaryTable.compositeUniques).toEqual([])
    expect(dictionaryTable.uniqueIndexes).toEqual([])
  })

  it('documents the partial unique predicate without claiming session_id is globally unique', () => {
    const dictionaryTable = describeTable(loginAudit)
    expect(dictionaryTable.uniqueIndexes).toEqual([
      {
        name: 'uq_login_audit_session_no_relationship',
        columns: ['session_id'],
        where: '"bng"."login_audit"."current_relationship_id" is null'
      }
    ])
    expect(
      dictionaryTable.columns.find((column) => column.name === 'session_id')
        .unique
    ).toBe(false)
    expect(renderPostgresSection([dictionaryTable])).toContain(
      'UNIQUE INDEX `uq_login_audit_session_no_relationship` (`session_id`) WHERE `"bng"."login_audit"."current_relationship_id" is null`.'
    )
  })
})
