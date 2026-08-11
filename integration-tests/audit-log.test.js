import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'

const HTTP_OK = 200
const EXPECTED_AUDIT_ROWS = 2
const ORIGINAL_NAME = 'Audit Test Project'
const RENAMED_NAME = 'Audit Test Project (renamed)'

describe('audit_log reflects submit + rename', () => {
  let server
  let dbClient
  let projectId
  let headers
  const userId = `it-${randomUUID()}`

  beforeAll(async () => {
    server = await startServer()
    dbClient = await connect()
    headers = authHeaders(await mintToken({ sub: userId }))
  })

  afterAll(async () => {
    // audit_log is append-only (guard triggers), so this teardown cannot DELETE
    // its rows directly; truncateTestData resets the throwaway DB by suspending
    // the guard for its own connection.
    if (projectId) {
      await truncateTestData(dbClient)
    }
    await dbClient.end()
    await stopServer(server)
  })

  it('writes INSERT then UPDATE rows', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/projects/new',
      headers,
      payload: { project: { name: ORIGINAL_NAME } }
    })
    expect(created.statusCode).toBe(HTTP_OK)
    projectId = created.result.id
    expect(projectId).toBeDefined()

    const renamed = await server.inject({
      method: 'PATCH',
      url: `/projects/${projectId}`,
      headers,
      payload: { project: { name: RENAMED_NAME } }
    })
    expect(renamed.statusCode).toBe(HTTP_OK)

    const { rows } = await dbClient.query(
      `SELECT operation, project->>'name' AS name,
              previous_project->>'name' AS previous_name, user_id,
              bng_project_version, audited_at
         FROM bng.audit_log
        WHERE project_id = $1
        ORDER BY audited_at`,
      [projectId]
    )

    expect(rows).toHaveLength(EXPECTED_AUDIT_ROWS)
    const [insertRow, updateRow] = rows

    // Each snapshot captures the acting user, the operation, and the project name.
    expect(insertRow).toMatchObject({
      operation: 'INSERT',
      name: ORIGINAL_NAME,
      previous_name: null,
      user_id: userId
    })
    expect(updateRow).toMatchObject({
      operation: 'UPDATE',
      name: RENAMED_NAME,
      previous_name: ORIGINAL_NAME,
      user_id: userId
    })

    // Each snapshot also records the project version (integer) and an audit
    // timestamp; the UPDATE is recorded no earlier than the INSERT.
    for (const row of rows) {
      expect(Number.isInteger(row.bng_project_version)).toBe(true)
      expect(row.bng_project_version).toBeGreaterThanOrEqual(1)
      expect(row.audited_at).toBeInstanceOf(Date)
    }
    expect(updateRow.audited_at.getTime()).toBeGreaterThanOrEqual(
      insertRow.audited_at.getTime()
    )
  })
  it('rejects project deletion without an audited deletion workflow', async () => {
    await expect(
      dbClient.query('DELETE FROM bng.projects WHERE id = $1', [projectId])
    ).rejects.toMatchObject({
      code: '42501',
      message: expect.stringContaining('audited deletion workflow')
    })
  })
  it('copies an explicitly supplied database actor separately from the project owner', async () => {
    const actorId = `actor-${randomUUID()}`
    const actorChangeName = 'Changed by a different actor'

    await dbClient.query(
      `UPDATE bng.projects
          SET project = jsonb_set(project, '{name}', to_jsonb($1::text)),
              last_modified_by = $2
        WHERE id = $3`,
      [actorChangeName, actorId, projectId]
    )

    const { rows } = await dbClient.query(
      `SELECT a.user_id, a.project->>'name' AS name, p.user_id AS owner_id,
              a.operation, a.audited_at
         FROM bng.audit_log a
         JOIN bng.projects p ON p.id = a.project_id
        WHERE a.project_id = $1
        ORDER BY a.audited_at DESC, a.id DESC
        LIMIT 1`,
      [projectId]
    )

    expect(rows[0]).toMatchObject({
      user_id: actorId,
      owner_id: userId,
      name: actorChangeName,
      operation: 'UPDATE'
    })
    expect(rows[0].audited_at).toBeInstanceOf(Date)
  })

  it('keeps previous-version project writes compatible during a rolling deployment', async () => {
    const previousVersionProjectId = randomUUID()
    const previousVersionUserId = `previous-version-${randomUUID()}`
    const originalName = 'Created by previous application version'
    const updatedName = 'Updated by previous application version'

    const inserted = await dbClient.query(
      `INSERT INTO bng.projects (id, project, user_id)
       VALUES ($1, $2, $3)
       RETURNING last_modified_by`,
      [previousVersionProjectId, { name: originalName }, previousVersionUserId]
    )
    expect(inserted.rows[0].last_modified_by).toBe(previousVersionUserId)

    await dbClient.query(
      `UPDATE bng.projects
          SET project = jsonb_set(project, '{name}', to_jsonb($1::text))
        WHERE id = $2`,
      [updatedName, previousVersionProjectId]
    )

    const { rows } = await dbClient.query(
      `SELECT operation, project->>'name' AS name,
              previous_project->>'name' AS previous_name, user_id
         FROM bng.audit_log
        WHERE project_id = $1
        ORDER BY audited_at, id`,
      [previousVersionProjectId]
    )

    expect(rows).toEqual([
      expect.objectContaining({
        operation: 'INSERT',
        name: originalName,
        previous_name: null,
        user_id: previousVersionUserId
      }),
      expect.objectContaining({
        operation: 'UPDATE',
        name: updatedName,
        previous_name: originalName,
        user_id: previousVersionUserId
      })
    ])
  })
})
