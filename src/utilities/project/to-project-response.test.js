import { describe, expect, it } from 'vitest'

import { toProjectResponse } from './to-project-response.js'

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
    expect(toProjectResponse(row)).toEqual({
      ...row,
      projectId: PROJECT_ID,
      tradingRuleStatuses: {
        areaHabitats: { medium: null, low: null, overall: 'Not met' }
      }
    })
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

  describe('the derived trading-rules statuses', () => {
    const withPostIntervention = (areaHabitats) => ({
      ...row,
      project: {
        ...row.project,
        postIntervention: { tradingRules: { areaHabitats } }
      }
    })

    it('reports Not met when no post-intervention file was uploaded', () => {
      // Nothing has been delivered to trade against, so the rules cannot be
      // met. Neither band is derived, because each one needs both files.
      expect(toProjectResponse(row).tradingRuleStatuses.areaHabitats).toEqual({
        medium: null,
        low: null,
        overall: 'Not met'
      })
    })

    it('derives the statuses from the persisted figures', () => {
      // A Medium broad habitat in deficit fails that band, and with it the
      // site — even though the Low band has units to spare.
      const response = toProjectResponse(
        withPostIntervention({
          habitatTypes: [],
          medium: {
            broadHabitats: [{ broadHabitat: 'Lakes', netUnitChange: -4 }],
            surplus: 0,
            deficit: -4
          },
          low: { netUnitChange: 2, cumulativeAvailability: 2 }
        })
      )

      expect(response.tradingRuleStatuses.areaHabitats).toEqual({
        medium: 'Not met',
        low: 'Met',
        overall: 'Not met'
      })
    })

    it('has no verdict where the figures were never calculated', () => {
      // A file was uploaded but the figures are missing. Unknown is not the
      // same as failed, so every status is null and consumers show nothing.
      const response = toProjectResponse({
        ...row,
        project: { ...row.project, postIntervention: {} }
      })

      expect(response.tradingRuleStatuses.areaHabitats).toEqual({
        medium: null,
        low: null,
        overall: null
      })
    })

    it('keeps them off the document, like projectId', () => {
      // Same round-trip reason: projectSchema rejects unknown keys.
      const response = toProjectResponse(row)

      expect(response.project).not.toHaveProperty('tradingRuleStatuses')
      expect(response.project.postIntervention).toBeUndefined()
    })
  })
})
