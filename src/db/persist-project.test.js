import { describe, test, expect, vi } from 'vitest'

import {
  insertProject,
  setProjectName,
  setProjectBaseline,
  setBaselineFeature,
  setProjectHabitatData,
  setProjectFeature,
  setProjectDetails
} from './persist-project.js'

const FEATURE_ID = '11111111-1111-1111-1111-111111111111'
const PROJECT_ID = '22222222-2222-2222-2222-222222222222'

const validUnitsTotals = {
  totalUnits: 0,
  habitatsTotal: 0,
  hedgerowsTotal: 0,
  watercoursesTotal: 0,
  treesTotal: 0,
  treesUrbanTotal: 0,
  treesRuralTotal: 0
}
const validHabitat = { featureId: FEATURE_ID, status: 'Complete' }

// One mock supports every chain the helpers use:
//   insert(projects).values(...).returning()
//   update(projects).set(...).where(...)            (awaited, no returning)
//   update(projects).set(...).where(...).returning()
function makeDb(returningRows = [{ id: PROJECT_ID, project: {} }]) {
  const returning = vi.fn().mockResolvedValue(returningRows)
  const where = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where })
  const update = vi.fn().mockReturnValue({ set })
  const values = vi.fn().mockReturnValue({ returning })
  const insert = vi.fn().mockReturnValue({ values })
  return { insert, update, _insert: insert, _update: update, _set: set }
}

describe('insertProject', () => {
  test('inserts and returns the row when the document is valid', async () => {
    const db = makeDb([{ id: PROJECT_ID, project: { name: 'P' } }])
    const row = await insertProject(db, {
      project: { name: 'P' },
      userId: 'u'
    })
    expect(db._insert).toHaveBeenCalledTimes(1)
    expect(row).toEqual({ id: PROJECT_ID, project: { name: 'P' } })
  })

  test('throws and does not write when the document is invalid', async () => {
    const db = makeDb()
    await expect(
      insertProject(db, { project: { name: 123 }, userId: 'u' })
    ).rejects.toThrow(/failed schema validation/)
    expect(db._insert).not.toHaveBeenCalled()
  })
})

describe('setProjectName', () => {
  test('writes and returns the row for a valid name', async () => {
    const db = makeDb([{ id: PROJECT_ID }])
    const row = await setProjectName(db, PROJECT_ID, 'New name')
    expect(db._update).toHaveBeenCalledTimes(1)
    expect(row).toEqual({ id: PROJECT_ID })
  })

  test('returns null when no project matches', async () => {
    const db = makeDb([])
    expect(await setProjectName(db, PROJECT_ID, 'New name')).toBeNull()
  })

  test('throws and does not write for an invalid name', async () => {
    const db = makeDb()
    await expect(setProjectName(db, PROJECT_ID, 123)).rejects.toThrow(
      /failed schema validation/
    )
    expect(db._update).not.toHaveBeenCalled()
  })
})

describe('setProjectBaseline', () => {
  test('writes when the baseline subtree is valid', async () => {
    const db = makeDb()
    await setProjectBaseline(db, PROJECT_ID, {
      importedAt: '2026-01-01T00:00:00.000Z',
      habitats: []
    })
    expect(db._update).toHaveBeenCalledTimes(1)
  })

  test('throws and does not write for an invalid baseline', async () => {
    const db = makeDb()
    await expect(
      setProjectBaseline(db, PROJECT_ID, { fileSize: -5 })
    ).rejects.toThrow(/failed schema validation/)
    expect(db._update).not.toHaveBeenCalled()
  })
})

describe('setBaselineFeature', () => {
  test('writes when the feature and totals are valid', async () => {
    const db = makeDb()
    await setBaselineFeature(db, PROJECT_ID, {
      layer: 'habitats',
      index: 0,
      feature: validHabitat,
      unitsTotals: validUnitsTotals
    })
    expect(db._update).toHaveBeenCalledTimes(1)
  })

  test('throws for an unknown layer', async () => {
    const db = makeDb()
    await expect(
      setBaselineFeature(db, PROJECT_ID, {
        layer: 'trees',
        index: 0,
        feature: validHabitat,
        unitsTotals: validUnitsTotals
      })
    ).rejects.toThrow(/unknown feature layer/)
    expect(db._update).not.toHaveBeenCalled()
  })

  test('throws and does not write for an invalid feature', async () => {
    const db = makeDb()
    await expect(
      setBaselineFeature(db, PROJECT_ID, {
        layer: 'habitats',
        index: 0,
        feature: { featureId: FEATURE_ID, status: 'Bogus' },
        unitsTotals: validUnitsTotals
      })
    ).rejects.toThrow(/failed schema validation/)
    expect(db._update).not.toHaveBeenCalled()
  })

  test('throws when the unit totals are incomplete', async () => {
    const db = makeDb()
    await expect(
      setBaselineFeature(db, PROJECT_ID, {
        layer: 'habitats',
        index: 0,
        feature: validHabitat,
        unitsTotals: { totalUnits: 1 }
      })
    ).rejects.toThrow(/failed schema validation/)
    expect(db._update).not.toHaveBeenCalled()
  })
})

const validPostInterventionHabitat = {
  featureId: FEATURE_ID,
  ref: 'H1',
  retentionCategory: 'Retained',
  area: 100,
  sizeSquareMetres: 100,
  units: 1,
  status: 'Complete',
  baseline: {
    type: 'Modified grassland',
    broadType: 'Grassland',
    condition: 'Moderate'
  },
  proposed: {
    type: 'Lowland meadows',
    broadType: 'Grassland',
    condition: 'Good'
  },
  properties: {}
}

describe('setProjectHabitatData', () => {
  test('writes post-intervention document with nested baseline/proposed fields', async () => {
    const db = makeDb()
    await setProjectHabitatData(
      db,
      PROJECT_ID,
      {
        importedAt: '2026-01-01T00:00:00.000Z',
        habitats: [validPostInterventionHabitat],
        hedgerows: [],
        watercourses: []
      },
      'postIntervention'
    )
    expect(db._update).toHaveBeenCalledTimes(1)
  })

  test('rejects flat habitat fields on post-intervention document', async () => {
    const db = makeDb()
    await expect(
      setProjectHabitatData(
        db,
        PROJECT_ID,
        {
          importedAt: '2026-01-01T00:00:00.000Z',
          habitats: [{ ...validPostInterventionHabitat, type: 'Grassland' }],
          hedgerows: [],
          watercourses: []
        },
        'postIntervention'
      )
    ).rejects.toThrow(/"habitats\[0\]\.type" is not allowed/)
    expect(db._update).not.toHaveBeenCalled()
  })
})

const validDetails = {
  localPlanningAuthority: 'South Downs National Park',
  developmentType: 'Small site'
}

describe('setProjectDetails', () => {
  test('writes and returns the row for valid details', async () => {
    const db = makeDb([{ id: PROJECT_ID, project: { details: validDetails } }])
    const row = await setProjectDetails(db, PROJECT_ID, validDetails)
    expect(db._update).toHaveBeenCalledTimes(1)
    expect(row).toEqual({ id: PROJECT_ID, project: { details: validDetails } })
  })

  test('returns null when no project matches', async () => {
    const db = makeDb([])
    expect(await setProjectDetails(db, PROJECT_ID, {})).toBeNull()
  })

  test('throws and does not write for invalid details', async () => {
    const db = makeDb()
    await expect(
      setProjectDetails(db, PROJECT_ID, { developmentType: 'Bad' })
    ).rejects.toThrow(/failed schema validation/)
    expect(db._update).not.toHaveBeenCalled()
  })
})

describe('setProjectFeature — postIntervention', () => {
  test('writes when the nested feature and totals are valid', async () => {
    const db = makeDb()
    await setProjectFeature(db, PROJECT_ID, {
      documentKey: 'postIntervention',
      layer: 'habitats',
      index: 0,
      feature: validPostInterventionHabitat,
      unitsTotals: validUnitsTotals
    })
    expect(db._update).toHaveBeenCalledTimes(1)
  })

  test('rejects flat habitat fields on post-intervention feature save', async () => {
    const db = makeDb()
    await expect(
      setProjectFeature(db, PROJECT_ID, {
        documentKey: 'postIntervention',
        layer: 'habitats',
        index: 0,
        feature: { ...validPostInterventionHabitat, type: 'Grassland' },
        unitsTotals: validUnitsTotals
      })
    ).rejects.toThrow(/"type" is not allowed/)
    expect(db._update).not.toHaveBeenCalled()
  })
})
