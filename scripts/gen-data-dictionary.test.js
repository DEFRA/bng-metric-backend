import { describe, expect, it } from 'vitest'
import { pgSchema, text, unique } from 'drizzle-orm/pg-core'
import { describeTable, renderPostgresSection } from './gen-data-dictionary.js'
import { loginAudit, relationships, roles } from '../src/db/schema/index.js'

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
    (schema, name, columns) => {
      const table = describeTable(schema)
      expect(table.compositeUniques).toEqual([{ name, columns }])
      for (const column of columns) {
        expect(
          table.columns.find((entry) => entry.name === column).unique
        ).toBe(false)
      }
      const markdown = renderPostgresSection([table])
      expect(markdown).toContain(
        `UNIQUE (${columns.map((column) => `\`${column}\``).join(', ')})`
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
      (table) => [unique('uq_named').on(table.named)]
    )
    const table = describeTable(schema)
    expect(table.columns.map(({ name, unique }) => ({ name, unique }))).toEqual(
      [
        { name: 'inline', unique: true },
        { name: 'named', unique: true },
        { name: 'ordinary', unique: false }
      ]
    )
    expect(table.compositeUniques).toEqual([])
    expect(table.uniqueIndexes).toEqual([])
  })

  it('documents the partial unique predicate without claiming session_id is globally unique', () => {
    const table = describeTable(loginAudit)
    expect(table.uniqueIndexes).toEqual([
      {
        name: 'uq_login_audit_session_no_relationship',
        columns: ['session_id'],
        where: '"bng"."login_audit"."current_relationship_id" is null'
      }
    ])
    expect(
      table.columns.find((column) => column.name === 'session_id').unique
    ).toBe(false)
    expect(renderPostgresSection([table])).toContain(
      'UNIQUE INDEX `uq_login_audit_session_no_relationship` (`session_id`) WHERE `"bng"."login_audit"."current_relationship_id" is null`.'
    )
  })
})
