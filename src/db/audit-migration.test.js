import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

const migration = readFileSync(
  new URL('../../changelog/db.changelog-1.11.xml', import.meta.url),
  'utf8'
)

function statementPosition(statement) {
  const position = migration.indexOf(statement)
  expect(position, `missing migration statement: ${statement}`).toBeGreaterThan(
    -1
  )
  return position
}

function actorAuditChangeSet() {
  const start = statementPosition('<changeSet id="32"')
  const nextChangeSet = statementPosition('<changeSet id="35"')
  return migration.slice(start, nextChangeSet)
}

describe('last_modified_by migration backfill', () => {
  test('does not emit false audit events or alter genuine modification times', () => {
    const disableAudit = statementPosition('DISABLE TRIGGER write_audit_log')
    const disableUpdatedAt = statementPosition('DISABLE TRIGGER set_updated_at')
    const backfill = statementPosition('SET last_modified_by = user_id')
    const enableUpdatedAt = statementPosition('ENABLE TRIGGER set_updated_at')
    const enableAudit = statementPosition('ENABLE TRIGGER write_audit_log')

    expect(disableAudit).toBeLessThan(backfill)
    expect(disableUpdatedAt).toBeLessThan(backfill)
    expect(enableUpdatedAt).toBeGreaterThan(backfill)
    expect(enableAudit).toBeGreaterThan(backfill)
  })

  test('applies the actor column, before-state column and final audit function atomically', () => {
    const changeSet = actorAuditChangeSet()

    expect(changeSet.match(/<changeSet\b/g)).toHaveLength(1)
    expect(changeSet).toContain('tableName="projects"')
    expect(changeSet).toContain('name="last_modified_by"')
    expect(changeSet).toContain('tableName="audit_log"')
    expect(changeSet).toContain('name="previous_project"')
    expect(changeSet).toContain(
      "CASE WHEN TG_OP = 'UPDATE' THEN OLD.project ELSE NULL END"
    )
    expect(changeSet).toContain('NEW.last_modified_by')
  })

  test('installs the previous-version insert fallback before enforcing not null', () => {
    const changeSet = actorAuditChangeSet()
    const fallbackFunction = changeSet.indexOf(
      'CREATE OR REPLACE FUNCTION bng.ensure_project_actor()'
    )
    const fallbackAssignment = changeSet.indexOf(
      'NEW.last_modified_by := NEW.user_id'
    )
    const fallbackTrigger = changeSet.indexOf(
      'CREATE TRIGGER ensure_project_actor'
    )
    const insertOnlyTrigger = changeSet.indexOf('BEFORE INSERT ON bng.projects')
    const notNullConstraint = changeSet.indexOf('<addNotNullConstraint')

    expect(fallbackFunction).toBeGreaterThan(-1)
    expect(fallbackAssignment).toBeGreaterThan(fallbackFunction)
    expect(fallbackTrigger).toBeGreaterThan(fallbackAssignment)
    expect(insertOnlyTrigger).toBeGreaterThan(fallbackTrigger)
    expect(notNullConstraint).toBeGreaterThan(fallbackTrigger)
  })
})
