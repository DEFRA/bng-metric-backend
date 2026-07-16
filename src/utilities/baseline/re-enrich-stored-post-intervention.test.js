import { describe, it, expect, vi, beforeEach } from 'vitest'

import { reEnrichStoredPostInterventionIfPresent } from './re-enrich-stored-post-intervention.js'
import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import { setProjectHabitatData } from '../../db/persist-project.js'

vi.mock('./enrich-post-intervention-units.js', () => ({
  enrichPostInterventionDocumentWithUnits: vi.fn()
}))

vi.mock('../../db/persist-project.js', () => ({
  setProjectHabitatData: vi.fn().mockResolvedValue(undefined)
}))

function makeSelectChain(row) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(row ? [row] : []))
  }
  return chain
}

describe('reEnrichStoredPostInterventionIfPresent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('re-enriches and persists post-intervention when baseline linear lengths exist', async () => {
    const baselineUnits = {
      habitatsTotal: 6,
      treesTotal: 2,
      hedgerowsTotal: 4,
      watercoursesTotal: 3
    }
    const postIntervention = {
      watercourses: [
        {
          ref: 'R1',
          sizeMetres: 1000,
          retentionCategory: 'Enhanced'
        }
      ]
    }
    const drizzle = {
      select: vi.fn(() =>
        makeSelectChain({
          project: {
            postIntervention,
            baseline: {
              watercourses: [{ ref: 'R1', sizeMetres: 1000 }],
              units: baselineUnits
            }
          }
        })
      )
    }
    const logger = { warn: vi.fn() }

    await reEnrichStoredPostInterventionIfPresent(drizzle, 'project-id', logger)

    expect(enrichPostInterventionDocumentWithUnits).toHaveBeenCalledWith(
      postIntervention,
      logger,
      expect.objectContaining({
        baselineLengthByRef: expect.any(Map),
        baselineUnits
      })
    )
    expect(setProjectHabitatData).toHaveBeenCalledWith(
      drizzle,
      'project-id',
      postIntervention,
      'postIntervention'
    )
  })

  it('no-ops when the project has no post-intervention document', async () => {
    const drizzle = {
      select: vi.fn(() => makeSelectChain({ project: {} }))
    }

    await reEnrichStoredPostInterventionIfPresent(drizzle, 'project-id', {
      warn: vi.fn()
    })

    expect(enrichPostInterventionDocumentWithUnits).not.toHaveBeenCalled()
    expect(setProjectHabitatData).not.toHaveBeenCalled()
  })
})
