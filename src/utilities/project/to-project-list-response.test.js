import { describe, expect, it } from 'vitest'

import {
  toProjectListResponse,
  toProjectListResponses
} from './to-project-list-response.js'

const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const SECOND_ID = 'a7dc53f2-05d2-4d75-9186-7e5cf52864bd'

const row = {
  id: PROJECT_ID,
  name: 'Greenfield Meadow Restoration',
  hasBaseline: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02')
}

describe('#toProjectListResponse', () => {
  it('emits exactly the list fields', () => {
    expect(toProjectListResponse(row)).toEqual({
      id: PROJECT_ID,
      projectId: PROJECT_ID,
      project: { name: 'Greenfield Meadow Restoration' },
      hasBaseline: true,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02')
    })
  })

  it('keeps the name nested under project, as the list view reads it', () => {
    expect(toProjectListResponse(row).project.name).toBe(
      'Greenfield Meadow Restoration'
    )
  })

  it('surfaces the row id as projectId', () => {
    expect(toProjectListResponse(row).projectId).toBe(PROJECT_ID)
  })

  it('reports hasBaseline false when the document has no baseline', () => {
    expect(
      toProjectListResponse({ ...row, hasBaseline: false }).hasBaseline
    ).toBe(false)
  })

  // BMD-933: this mapper is the guard against a document body reaching a list
  // response. It names every field, so nothing can be spread in by accident.
  it('drops any document body handed to it', () => {
    const withDocument = {
      ...row,
      project: { name: 'Greenfield', baseline: { habitats: [{}] } },
      userId: 'test-user-001',
      bngProjectVersion: 1
    }

    const result = toProjectListResponse(withDocument)

    expect(result.project).toEqual({ name: 'Greenfield Meadow Restoration' })
    expect(result.project).not.toHaveProperty('baseline')
    expect(result).not.toHaveProperty('userId')
    expect(result).not.toHaveProperty('bngProjectVersion')
  })

  it('does not mutate the row', () => {
    const original = { ...row }

    toProjectListResponse(row)

    expect(row).toEqual(original)
  })
})

describe('#toProjectListResponses', () => {
  it('maps every row', () => {
    const second = { ...row, id: SECOND_ID }

    expect(
      toProjectListResponses([row, second]).map((r) => r.projectId)
    ).toEqual([PROJECT_ID, SECOND_ID])
  })

  it('returns an empty array unchanged', () => {
    expect(toProjectListResponses([])).toEqual([])
  })
})
