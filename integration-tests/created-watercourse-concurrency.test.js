import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  calculateCreatedWatercoursePostIntervention,
  roundToSigFigs
} from 'bng-library/metric'
import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'

let server
let dbClient
let observer
let headers
const userId = `it-${randomUUID()}`

beforeAll(async () => {
  server = await startServer()
  dbClient = await connect()
  observer = await connect()
  headers = authHeaders(await mintToken({ sub: userId }))
  await truncateTestData(dbClient)
})

afterAll(async () => {
  await truncateTestData(dbClient)
  await observer.end()
  await dbClient.end()
  await stopServer(server)
})

async function blockedByProjectLock(pid) {
  // Follow the blocking chain: PostgreSQL can queue the second request behind
  // the first waiter, rather than directly behind our external row lock.
  const { rows } = await observer.query(
    `WITH RECURSIVE blocked AS (
       SELECT pid FROM pg_stat_activity
       WHERE $1 = ANY(pg_blocking_pids(pid))
       UNION
       SELECT activity.pid FROM pg_stat_activity activity
       JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
     ) SELECT count(*)::integer AS count FROM blocked`,
    [pid]
  )
  return rows[0].count
}

it('preserves both overlapping template sibling edits, lineage and totals', async () => {
  const parent = {
    featureId: randomUUID(),
    ref: 'Parent',
    type: 'Ditches',
    condition: 'Moderate',
    sizeMetres: 1000,
    strategicSignificance: 'Low',
    watercourseEncroachment: 'No Encroachment',
    riparianEncroachment: 'No Encroachment/No Encroachment'
  }
  const children = ['First', 'Second'].map((ref) => ({
    featureId: randomUUID(),
    parentFeatureId: parent.featureId,
    ref,
    retentionCategory: 'Created',
    sizeMetres: 500,
    status: 'Incomplete',
    units: null,
    editedAdvanceYears: 10,
    properties: { 'Habitat created in advance/years': 5 },
    baseline: {},
    proposed: {
      type: 'Ditches',
      condition: 'Moderate',
      strategicSignificance: 'Low',
      advanceYears: 10,
      delayYears: 0,
      watercourseEncroachment: 'Major',
      riparianEncroachment: 'No Encroachment/No Encroachment'
    }
  }))
  const projectId = randomUUID()
  await dbClient.query(
    `INSERT INTO bng.projects (id, project, user_id, last_modified_by)
     VALUES ($1, $2, $3, $3)`,
    [
      projectId,
      {
        name: 'Concurrent template sibling edits IT',
        baseline: { watercourses: [parent] },
        postIntervention: {
          template: { name: 'bng-service', version: '1.0' },
          watercourses: children
        }
      },
      userId
    ]
  )
  const edits = [
    { ref: 'First renamed', habitatType: 'Canals', advanceYears: 10 },
    { ref: 'Second renamed', habitatType: 'Ditches', advanceYears: 0 }
  ].map((edit) => ({
    condition: 'Moderate',
    strategicSignificance: 'High',
    watercourseEncroachment: 'Major',
    riparianEncroachment: 'No Encroachment/No Encroachment',
    delayYears: 0,
    ...edit
  }))

  let lockHeld = false
  let pending = Promise.resolve([])
  let responses
  try {
    await dbClient.query('BEGIN')
    lockHeld = true
    await dbClient.query(
      'SELECT id FROM bng.projects WHERE id = $1 FOR UPDATE',
      [projectId]
    )
    const {
      rows: [{ pid }]
    } = await dbClient.query('SELECT pg_backend_pid() AS pid')
    pending = Promise.allSettled(
      edits.map((payload, index) =>
        server.inject({
          method: 'PUT',
          url: `/projects/${projectId}/post-intervention/watercourses/${children[index].featureId}`,
          headers,
          payload
        })
      )
    )
    // Both requests must reach the real database before either may write.
    // This also forces a lost-update race if the route's read lock is removed.
    await expect
      .poll(() => blockedByProjectLock(pid), {
        timeout: 2000,
        interval: 20
      })
      .toBe(2)
    await dbClient.query('COMMIT')
    lockHeld = false
    responses = await pending
  } finally {
    if (lockHeld) {
      await dbClient.query('ROLLBACK')
    }
    await pending
  }
  for (const response of responses) {
    expect(response.status).toBe('fulfilled')
    expect(response.value.statusCode, response.value.payload).toBe(200)
  }

  const {
    rows: [{ project, last_modified_by: actor }]
  } = await dbClient.query(
    'SELECT project, last_modified_by FROM bng.projects WHERE id = $1',
    [projectId]
  )
  const document = project.postIntervention
  expect(actor).toBe(userId)
  const [first, second] = document.watercourses
  expect(first).toMatchObject({
    featureId: children[0].featureId,
    parentFeatureId: parent.featureId,
    ref: 'First renamed',
    editedAdvanceYears: 10,
    proposed: { type: 'Canals', advanceYears: null },
    units: null,
    status: 'Incomplete'
  })
  const expected = calculateCreatedWatercoursePostIntervention(
    0.5,
    'Ditches',
    'Moderate',
    'Major',
    'No Encroachment/No Encroachment',
    0,
    0,
    'High'
  )
  expect(second).toMatchObject({
    featureId: children[1].featureId,
    parentFeatureId: parent.featureId,
    ref: 'Second renamed',
    editedAdvanceYears: 0,
    proposed: {
      type: 'Ditches',
      advanceYears: 0,
      strategicSignificance: 'High'
    },
    units: expected.units,
    status: 'Complete'
  })
  expect(second.units).toBeGreaterThan(0)
  expect(document.units.watercoursesTotal).toBeCloseTo(
    roundToSigFigs(expected.units)
  )
  expect(document.lostHabitats).toEqual([
    expect.objectContaining({
      featureId: parent.featureId,
      outcome: 'lostAndRecreated',
      lostSizeMetres: 1000,
      recreatedAs: [second.featureId]
    })
  ])
})
