import { describe, expect, it } from 'vitest'

import { toProjectResponse, toProjectResponses } from './to-project-response.js'

const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'

const row = {
  id: PROJECT_ID,
  project: { name: 'Greenfield Meadow Restoration' },
  userId: 'test-user-001',
  bngProjectVersion: 1
}

describe('#toProjectResponse', () => {
  it('surfaces the row id as projectId', () => {
    expect(toProjectResponse(row).projectId).toBe(PROJECT_ID)
  })

  // The frontend and journey tests read `id`; this alias is additive only.
  it('retains every original field, including id', () => {
    expect(toProjectResponse(row)).toEqual({ ...row, projectId: PROJECT_ID })
  })

  it('does not mutate the row', () => {
    const original = { ...row }

    toProjectResponse(row)

    expect(row).toEqual(original)
  })

  it('leaves the project document untouched', () => {
    // projectId is an envelope concern: projectSchema rejects unknown keys, so
    // a document carrying it would fail the POST/PATCH round-trip.
    expect(toProjectResponse(row).project).not.toHaveProperty('projectId')
  })
})

describe('#toProjectResponses', () => {
  it('maps every row', () => {
    const second = { ...row, id: 'a7dc53f2-05d2-4d75-9186-7e5cf52864bd' }

    expect(toProjectResponses([row, second]).map((r) => r.projectId)).toEqual([
      PROJECT_ID,
      'a7dc53f2-05d2-4d75-9186-7e5cf52864bd'
    ])
  })

  it('returns an empty array unchanged', () => {
    expect(toProjectResponses([])).toEqual([])
  })
})
