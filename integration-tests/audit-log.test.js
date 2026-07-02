import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
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
    if (projectId) {
      await dbClient.query('DELETE FROM bng.audit_log WHERE project_id = $1', [
        projectId
      ])
      await dbClient.query('DELETE FROM bng.projects WHERE id = $1', [
        projectId
      ])
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
      `SELECT operation, project->>'name' AS name, user_id, bng_project_version, audited_at
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
      user_id: userId
    })
    expect(updateRow).toMatchObject({
      operation: 'UPDATE',
      name: RENAMED_NAME,
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
})
