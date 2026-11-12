import { describe, test, expect, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import {
  insertProject,
  setProjectName,
  setProjectBaseline,
  setProjectBaselineAndPostIntervention,
  setBaselineFeature,
  setProjectHabitatData,
  setProjectFeature,
  setProjectDetails
} from './persist-project.js'

const FEATURE_ID = '11111111-1111-1111-1111-111111111111'
const PROJECT_ID = '22222222-2222-2222-2222-222222222222'
const ACTOR_ID = 'defra-id-actor'

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
const validTree = {
  featureId: FEATURE_ID,
  ref: 'T1',
  broadType: 'Individual trees',
  type: 'Urban tree',
  condition: 'Moderate',
  status: 'Complete'
}

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
  return {
    insert,
    update,
    _insert: insert,
    _values: values,
    _update: update,
    _set: set,
    _returning: returning
  }
}

function expectActorStamped(db) {
  expect(db._set).toHaveBeenCalledWith(
    expect.objectContaining({ lastModifiedBy: ACTOR_ID })
  )
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
    expect(db._values).toHaveBeenCalledWith(
      expect.objectContaining({ lastModifiedBy: 'u' })
    )
  })

  test.each([undefined, null, '', '   '])(
    'rejects missing or blank creator identity: %j',
    async (userId) => {
      const db = makeDb()
      await expect(
        insertProject(db, { project: { name: 'P' }, userId })
      ).rejects.toThrow(/verified actor identity is required/)
      expect(db._insert).not.toHaveBeenCalled()
    }
  )

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
    const row = await setProjectName(db, PROJECT_ID, 'New name', ACTOR_ID)
    expect(db._update).toHaveBeenCalledTimes(1)
    expect(row).toEqual({ id: PROJECT_ID })
    expectActorStamped(db)
  })

  test('returns the whole row, which its route reads project.name from', async () => {
    const db = makeDb([{ id: PROJECT_ID, project: { name: 'New name' } }])

    await setProjectName(db, PROJECT_ID, 'New name', ACTOR_ID)

    // Guards against the details projection landing here by mistake: this
    // writer and setProjectDetails are otherwise identical in shape.
    expect(db._returning).toHaveBeenCalledWith()
  })

  test('returns null when no project matches', async () => {
    const db = makeDb([])
    expect(
      await setProjectName(db, PROJECT_ID, 'New name', ACTOR_ID)
    ).toBeNull()
  })

  test.each([undefined, null, '', '   '])(
    'rejects missing or blank actor identity: %j',
    async (actorId) => {
      const db = makeDb()
      await expect(
        setProjectName(db, PROJECT_ID, 'New name', actorId)
      ).rejects.toThrow(/verified actor identity is required/)
      expect(db._update).not.toHaveBeenCalled()
    }
  )

  test('throws and does not write for an invalid name', async () => {
    const db = makeDb()
    await expect(setProjectName(db, PROJECT_ID, 123, ACTOR_ID)).rejects.toThrow(
      /failed schema validation/
    )
    expect(db._update).not.toHaveBeenCalled()
  })
})

describe('setProjectBaseline', () => {
  test('AC3/AC4 replaces baseline and removes post-intervention atomically', async () => {
    const db = makeDb()
    await setProjectBaseline(
      db,
      PROJECT_ID,
      {
        importedAt: '2026-01-01T00:00:00.000Z',
        habitats: []
      },
      ACTOR_ID
    )
    expect(db._update).toHaveBeenCalledTimes(1)
    expectActorStamped(db)
    const [{ project }] = db._set.mock.calls[0]
    const { sql: updateSql } = new PgDialect().sqlToQuery(project)
    expect(updateSql).toContain('jsonb_set')
    expect(updateSql).toMatch(/- 'postIntervention'/)
  })

  test('rejects a missing actor before writing', async () => {
    const db = makeDb()
    await expect(
      setProjectBaseline(db, PROJECT_ID, {
        importedAt: '2026-01-01T00:00:00.000Z',
        habitats: []
      })
    ).rejects.toThrow(/verified actor identity is required/)
    expect(db._update).not.toHaveBeenCalled()
  })

  test('throws and does not write for an invalid baseline', async () => {
    const db = makeDb()
    await expect(
      setProjectBaseline(db, PROJECT_ID, { fileSize: -5 }, ACTOR_ID)
    ).rejects.toThrow(/failed schema validation/)
    expect(db._update).not.toHaveBeenCalled()
  })
})

describe('setProjectBaselineAndPostIntervention', () => {
  const baseline = { importedAt: '2026-01-01T00:00:00.000Z', habitats: [] }
  const postIntervention = {
    importedAt: '2026-01-01T00:00:00.000Z',
    habitats: [],
    hedgerows: [],
    watercourses: []
  }

  test('writes both documents in one update', async () => {
    const db = makeDb()
    await setProjectBaselineAndPostIntervention(
      db,
      PROJECT_ID,
      { baseline, postIntervention },
      ACTOR_ID
    )
    expect(db._update).toHaveBeenCalledTimes(1)
    expectActorStamped(db)
    const [{ project }] = db._set.mock.calls[0]
    const { sql: updateSql, params } = new PgDialect().sqlToQuery(project)
    expect(updateSql.match(/jsonb_set/g)).toHaveLength(2)
    expect(params).toEqual(
      expect.arrayContaining(['{baseline}', '{postIntervention}'])
    )
  })

  test('rejects a missing actor before writing', async () => {
    const db = makeDb()
    await expect(
      setProjectBaselineAndPostIntervention(db, PROJECT_ID, {
        baseline,
        postIntervention
      })
    ).rejects.toThrow(/verified actor identity is required/)
    expect(db._update).not.toHaveBeenCalled()
  })

  test.each([
    ['baseline', { baseline: { fileSize: -5 }, postIntervention }],
    [
      'post-intervention',
      { baseline, postIntervention: { ...postIntervention, fileSize: -5 } }
    ]
  ])(
    'throws and does not write for an invalid %s document',
    async (_label, documents) => {
      const db = makeDb()
      await expect(
        setProjectBaselineAndPostIntervention(
          db,
          PROJECT_ID,
          documents,
          ACTOR_ID
        )
      ).rejects.toThrow(/failed schema validation/)
      expect(db._update).not.toHaveBeenCalled()
    }
  )
})

describe('setBaselineFeature', () => {
  test('writes when the feature and totals are valid', async () => {
    const db = makeDb()
    await setBaselineFeature(db, PROJECT_ID, {
      layer: 'habitats',
      index: 0,
      feature: validHabitat,
      unitsTotals: validUnitsTotals,
      actorId: ACTOR_ID
    })
    expect(db._update).toHaveBeenCalledTimes(1)
    expectActorStamped(db)
  })

  test('rejects a missing actor before writing', async () => {
    const db = makeDb()
    await expect(
      setBaselineFeature(db, PROJECT_ID, {
        layer: 'habitats',
        index: 0,
        feature: validHabitat,
        unitsTotals: validUnitsTotals
      })
    ).rejects.toThrow(/verified actor identity is required/)
    expect(db._update).not.toHaveBeenCalled()
  })

  // Deliberately not a plausible habitat layer, so it can never become a real
  // one and quietly stop testing the throw — which is what happened to `trees`
  // (see below).
  test('throws for an unknown layer', async () => {
    const db = makeDb()
    await expect(
      setBaselineFeature(db, PROJECT_ID, {
        layer: 'notALayer',
        index: 0,
        feature: validHabitat,
        unitsTotals: validUnitsTotals,
        actorId: ACTOR_ID
      })
    ).rejects.toThrow(/unknown feature layer/)
    expect(db._update).not.toHaveBeenCalled()
  })

  // This layer stood in for the unknown one above until a baseline tree became
  // editable (BMD-1112): every tree edit then reached the choke point and was
  // refused as a developer error, 500, with nothing saved.
  test('writes a baseline tree, which is an editable layer', async () => {
    const db = makeDb()
    await setBaselineFeature(db, PROJECT_ID, {
      layer: 'trees',
      index: 0,
      feature: validTree,
      unitsTotals: validUnitsTotals,
      actorId: ACTOR_ID
    })
    expect(db._update).toHaveBeenCalledTimes(1)
    expectActorStamped(db)
  })

  // A Created post-intervention tree is editable (BMD-1172), against the
  // post-intervention tree's own schema, which a baseline tree does not pass.
  test('checks a post-intervention tree against the post-intervention tree schema', async () => {
    const db = makeDb()
    await expect(
      setProjectFeature(db, PROJECT_ID, {
        documentKey: 'postIntervention',
        layer: 'trees',
        index: 0,
        feature: validTree,
        unitsTotals: validUnitsTotals,
        actorId: ACTOR_ID
      })
    ).rejects.toThrow(/postIntervention\.trees\[0\] failed schema validation/)
    expect(db._update).not.toHaveBeenCalled()
  })

  test('writes a post-intervention tree', async () => {
    const db = makeDb()
    await setProjectFeature(db, PROJECT_ID, {
      documentKey: 'postIntervention',
      layer: 'trees',
      index: 0,
      feature: validPostInterventionTree,
      unitsTotals: validUnitsTotals,
      actorId: ACTOR_ID
    })
    expect(db._update).toHaveBeenCalledTimes(1)
  })

  test('throws and does not write for an invalid feature', async () => {
    const db = makeDb()
    await expect(
      setBaselineFeature(db, PROJECT_ID, {
        layer: 'habitats',
        index: 0,
        feature: { featureId: FEATURE_ID, status: 'Bogus' },
        unitsTotals: validUnitsTotals,
        actorId: ACTOR_ID
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
        unitsTotals: { totalUnits: 1 },
        actorId: ACTOR_ID
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

const validPostInterventionTree = {
  featureId: FEATURE_ID,
  ref: 'T1',
  retentionCategory: 'Created',
  count: 1,
  area: 41,
  sizeSquareMetres: 41,
  units: 0.1,
  status: 'Complete',
  baseline: {},
  proposed: {
    type: 'Rural tree',
    broadType: 'Individual trees',
    condition: 'Poor',
    treeSize: 'Small'
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
      ACTOR_ID,
      'postIntervention'
    )
    expect(db._update).toHaveBeenCalledTimes(1)
    expectActorStamped(db)
  })

  test('rejects a missing actor before writing', async () => {
    const db = makeDb()
    await expect(
      setProjectHabitatData(
        db,
        PROJECT_ID,
        {
          importedAt: '2026-01-01T00:00:00.000Z',
          habitats: [],
          hedgerows: [],
          watercourses: []
        },
        undefined,
        'postIntervention'
      )
    ).rejects.toThrow(/verified actor identity is required/)
    expect(db._update).not.toHaveBeenCalled()
  })

  test('requires an explicit document key', async () => {
    const db = makeDb()
    await expect(
      setProjectHabitatData(
        db,
        PROJECT_ID,
        {
          importedAt: '2026-01-01T00:00:00.000Z',
          habitats: [],
          hedgerows: [],
          watercourses: []
        },
        ACTOR_ID
      )
    ).rejects.toThrow(/unknown habitat document key/)
    expect(db._update).not.toHaveBeenCalled()
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
        ACTOR_ID,
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
  test('asks Postgres for the details alone, not the whole row', async () => {
    const db = makeDb([{ details: validDetails }])

    await setProjectDetails(db, PROJECT_ID, validDetails, ACTOR_ID)

    // The projection is the point of the change: an unprojected returning()
    // would ship the entire project JSONB back to echo a few fields.
    const [projection] = db._returning.mock.calls[0]
    expect(Object.keys(projection)).toEqual(['details'])
  })

  test('writes and returns only the merged details', async () => {
    // The UPDATE returns the details sub-document, not the whole row: echoing
    // the merged fields never needs the project JSONB back.
    const db = makeDb([{ details: validDetails }])
    const row = await setProjectDetails(db, PROJECT_ID, validDetails, ACTOR_ID)
    expect(db._update).toHaveBeenCalledTimes(1)
    expect(row).toEqual({ details: validDetails })
    expectActorStamped(db)
  })

  test('rejects a missing actor before writing', async () => {
    const db = makeDb()
    await expect(
      setProjectDetails(db, PROJECT_ID, validDetails, undefined)
    ).rejects.toThrow(/verified actor identity is required/)
    expect(db._update).not.toHaveBeenCalled()
  })

  test('returns null when no project matches', async () => {
    const db = makeDb([])
    expect(await setProjectDetails(db, PROJECT_ID, {}, ACTOR_ID)).toBeNull()
  })

  test('throws and does not write for invalid details', async () => {
    const db = makeDb()
    await expect(
      setProjectDetails(db, PROJECT_ID, { developmentType: 'Bad' }, ACTOR_ID)
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
      unitsTotals: validUnitsTotals,
      actorId: ACTOR_ID
    })
    expect(db._update).toHaveBeenCalledTimes(1)
    expectActorStamped(db)
  })

  test('rejects a missing actor before writing', async () => {
    const db = makeDb()
    await expect(
      setProjectFeature(db, PROJECT_ID, {
        documentKey: 'postIntervention',
        layer: 'habitats',
        index: 0,
        feature: validPostInterventionHabitat,
        unitsTotals: validUnitsTotals
      })
    ).rejects.toThrow(/verified actor identity is required/)
    expect(db._update).not.toHaveBeenCalled()
  })

  test('rejects flat habitat fields on post-intervention feature save', async () => {
    const db = makeDb()
    await expect(
      setProjectFeature(db, PROJECT_ID, {
        documentKey: 'postIntervention',
        layer: 'habitats',
        index: 0,
        feature: { ...validPostInterventionHabitat, type: 'Grassland' },
        unitsTotals: validUnitsTotals,
        actorId: ACTOR_ID
      })
    ).rejects.toThrow(/"type" is not allowed/)
    expect(db._update).not.toHaveBeenCalled()
  })
})

describe('setProjectFeature — a value saved before BMD-1175', () => {
  test('refuses the edit with a 422 naming the field, not a 500, and writes nothing', async () => {
    const db = makeDb()
    const refused = await setProjectFeature(db, PROJECT_ID, {
      documentKey: 'postIntervention',
      layer: 'habitats',
      index: 0,
      feature: { ...validPostInterventionHabitat, ref: 'R'.repeat(100) },
      unitsTotals: validUnitsTotals,
      actorId: ACTOR_ID
    }).catch((error) => error)
    expect(refused.output.statusCode).toBe(422)
    expect(refused.output.payload.code).toBe('STORED_VALUE_NOT_ALLOWED')
    expect(refused.message).toMatch(/\(ref\)/)
    expect(refused.output.payload.fields).toEqual(['ref'])
    expect(db._update).not.toHaveBeenCalled()
  })

  test('still answers a broken fragment with a 500', async () => {
    const db = makeDb()
    const refused = await setProjectFeature(db, PROJECT_ID, {
      documentKey: 'postIntervention',
      layer: 'habitats',
      index: 0,
      feature: {
        ...validPostInterventionHabitat,
        ref: 'R'.repeat(100),
        type: 'Grassland'
      },
      unitsTotals: validUnitsTotals,
      actorId: ACTOR_ID
    }).catch((error) => error)
    expect(refused.output.statusCode).toBe(500)
  })
})

describe('setProjectFeature — trading rules', () => {
  // A habitat edit moves units between habitat types, so the caller recomputes
  // the trading-rules figures and passes them in to be written in the same
  // surgical update as the feature and the totals.
  const validTradingRules = {
    areaHabitats: {
      habitatTypes: [
        {
          habitatType: 'Lakes - Reservoirs',
          broadHabitat: 'Lakes',
          tradingBroadHabitat: 'Lakes',
          distinctiveness: 'Medium',
          netUnitChange: -3
        }
      ],
      medium: {
        broadHabitats: [{ broadHabitat: 'Lakes', netUnitChange: -3 }],
        surplus: 0,
        deficit: -3
      },
      low: { netUnitChange: 2, cumulativeAvailability: 2 }
    }
  }

  test('writes the trading rules when they are supplied', async () => {
    const db = makeDb()
    await setProjectFeature(db, PROJECT_ID, {
      documentKey: 'postIntervention',
      layer: 'habitats',
      index: 0,
      feature: validPostInterventionHabitat,
      unitsTotals: validUnitsTotals,
      tradingRules: validTradingRules,
      actorId: ACTOR_ID
    })

    expect(db._update).toHaveBeenCalledTimes(1)
    expectActorStamped(db)
  })

  test('rejects trading rules that fail their schema, before writing', async () => {
    const db = makeDb()
    await expect(
      setProjectFeature(db, PROJECT_ID, {
        documentKey: 'postIntervention',
        layer: 'habitats',
        index: 0,
        feature: validPostInterventionHabitat,
        unitsTotals: validUnitsTotals,
        tradingRules: {
          areaHabitats: {
            ...validTradingRules.areaHabitats,
            // The band aggregates are numbers; a string must not reach the
            // document, where every downstream consumer would trust it.
            medium: { ...validTradingRules.areaHabitats.medium, surplus: 'up' }
          }
        },
        actorId: ACTOR_ID
      })
    ).rejects.toThrow(/failed schema validation/)
    expect(db._update).not.toHaveBeenCalled()
  })
})

describe('setProjectFeature — lost habitats (BMD-1083)', () => {
  // A post-intervention edit to a template upload can change which baseline
  // habitats are lost and how, so the caller passes the refreshed list to be
  // written in the same surgical update as the feature.
  const lostHabitats = [
    {
      layer: 'habitats',
      featureId: FEATURE_ID,
      ref: 'H001',
      type: 'Tall forbs',
      outcome: 'lostAndRecreated',
      lostSizeSquareMetres: 100,
      recreatedAs: [FEATURE_ID]
    }
  ]
  const edit = (overrides) => ({
    documentKey: 'postIntervention',
    layer: 'habitats',
    index: 0,
    feature: validPostInterventionHabitat,
    unitsTotals: validUnitsTotals,
    actorId: ACTOR_ID,
    ...overrides
  })

  test('writes the lost habitats when they are supplied', async () => {
    const db = makeDb()
    await setProjectFeature(db, PROJECT_ID, edit({ lostHabitats }))

    expect(db._update).toHaveBeenCalledTimes(1)
    const [{ project }] = db._set.mock.calls[0]
    expect(new PgDialect().sqlToQuery(project).params).toContain(
      JSON.stringify(lostHabitats)
    )
  })

  test('rejects lost habitats that fail their schema, before writing', async () => {
    const db = makeDb()
    await expect(
      setProjectFeature(
        db,
        PROJECT_ID,
        edit({ lostHabitats: [{ ...lostHabitats[0], outcome: 'gone' }] })
      )
    ).rejects.toThrow(/failed schema validation/)
    expect(db._update).not.toHaveBeenCalled()
  })

  test('refuses to write lost habitats into the baseline document', async () => {
    const db = makeDb()
    await expect(
      setProjectFeature(
        db,
        PROJECT_ID,
        edit({
          documentKey: 'baseline',
          feature: validHabitat,
          lostHabitats
        })
      )
    ).rejects.toThrow(/only the post-intervention document/)
    expect(db._update).not.toHaveBeenCalled()
  })
})

describe('setProjectFeature — habitat sizes (BMD-1172)', () => {
  // A baseline tree edit can move a tree between the urban and rural sizes,
  // so the caller passes the refreshed summary to be written in the same
  // surgical update as the tree.
  const habitatSizes = {
    areaHabitats: { totalSquareMetres: 1123 },
    hedgerows: { totalMetres: 0 },
    watercourses: { totalMetres: 0 },
    trees: {
      totalSquareMetres: 123,
      urbanSquareMetres: 0,
      ruralSquareMetres: 123
    },
    site: { totalSquareMetres: 1000 }
  }
  const edit = (overrides) => ({
    layer: 'trees',
    index: 0,
    feature: { ...validTree, type: 'Rural tree' },
    unitsTotals: validUnitsTotals,
    actorId: ACTOR_ID,
    ...overrides
  })

  test('writes the habitat sizes when they are supplied', async () => {
    const db = makeDb()
    await setProjectFeature(db, PROJECT_ID, edit({ habitatSizes }))

    expect(db._update).toHaveBeenCalledTimes(1)
    const [{ project }] = db._set.mock.calls[0]
    const { params } = new PgDialect().sqlToQuery(project)
    expect(params).toContain('{baseline,habitatSizes}')
    expect(params).toContain(JSON.stringify(habitatSizes))
  })

  test('rejects habitat sizes that fail their schema, before writing', async () => {
    const db = makeDb()
    await expect(
      setProjectFeature(
        db,
        PROJECT_ID,
        edit({
          habitatSizes: {
            ...habitatSizes,
            trees: { ...habitatSizes.trees, ruralSquareMetres: 'lots' }
          }
        })
      )
    ).rejects.toThrow(/failed schema validation/)
    expect(db._update).not.toHaveBeenCalled()
  })

  // A Created post-intervention tree can move between the urban and rural
  // sizes too, so its document's summary is written with it.
  test('writes the habitat sizes into the post-intervention document', async () => {
    const db = makeDb()
    await setProjectFeature(
      db,
      PROJECT_ID,
      edit({
        documentKey: 'postIntervention',
        feature: validPostInterventionTree,
        habitatSizes
      })
    )

    expect(db._update).toHaveBeenCalledTimes(1)
    const [{ project }] = db._set.mock.calls[0]
    const { params } = new PgDialect().sqlToQuery(project)
    expect(params).toContain('{postIntervention,habitatSizes}')
  })
})

describe('setProjectFeature — re-derived post-intervention document', () => {
  // A baseline edit changes what the post-intervention document was measured
  // against, so the caller re-derives that document and hands it over whole —
  // it is the one subtree an edit can change in too many places to patch.
  const validPostInterventionDocument = {
    habitats: [],
    trees: [],
    hedgerows: [],
    watercourses: [],
    units: validUnitsTotals
  }

  function matchingTemplateEdit() {
    const postIntervention = {
      ...structuredClone(validPostInterventionDocument),
      template: { name: 'bng-service', version: '1.0' },
      habitats: [structuredClone(validPostInterventionHabitat)],
      units: { ...validUnitsTotals, totalUnits: 1, habitatsTotal: 1 },
      tradingRules: {},
      lostHabitats: []
    }
    return {
      documentKey: 'postIntervention',
      layer: 'habitats',
      index: 0,
      feature: postIntervention.habitats[0],
      unitsTotals: postIntervention.units,
      tradingRules: postIntervention.tradingRules,
      lostHabitats: postIntervention.lostHabitats,
      postIntervention,
      actorId: ACTOR_ID
    }
  }

  test('accepts a template replacement with matching fragments', async () => {
    const db = makeDb()
    await setProjectFeature(db, PROJECT_ID, matchingTemplateEdit())
    expect(db._update).toHaveBeenCalledTimes(1)
  })

  test.each([
    [
      'feature',
      { ...validPostInterventionHabitat, ref: 'Different reference' }
    ],
    ['unitsTotals', { ...validUnitsTotals, totalUnits: 2, habitatsTotal: 2 }],
    [
      'tradingRules',
      {
        areaHabitats: {
          habitatTypes: [],
          medium: { broadHabitats: [], surplus: 1, deficit: 0 },
          low: { netUnitChange: 0, cumulativeAvailability: 0 }
        }
      }
    ],
    [
      'lostHabitats',
      [
        {
          layer: 'habitats',
          featureId: FEATURE_ID,
          ref: 'H001',
          type: 'Tall forbs',
          outcome: 'lostAndRecreated',
          lostSizeSquareMetres: 100,
          recreatedAs: [FEATURE_ID]
        }
      ]
    ]
  ])(
    'rejects an otherwise matching template with conflicting %s before any update',
    async (field, conflict) => {
      const db = makeDb()
      await expect(
        setProjectFeature(db, PROJECT_ID, {
          ...matchingTemplateEdit(),
          [field]: conflict
        })
      ).rejects.toThrow(/without consistent template fragments/)
      expect(db._update).not.toHaveBeenCalled()
      expect(db._set).not.toHaveBeenCalled()
    }
  )

  test('writes it in the same update as the baseline feature', async () => {
    const db = makeDb()
    await setProjectFeature(db, PROJECT_ID, {
      documentKey: 'baseline',
      layer: 'habitats',
      index: 0,
      feature: validHabitat,
      unitsTotals: validUnitsTotals,
      postIntervention: validPostInterventionDocument,
      actorId: ACTOR_ID
    })

    // One UPDATE: the two documents can never be persisted apart.
    expect(db._update).toHaveBeenCalledTimes(1)
    expectActorStamped(db)
  })

  test('accepts a baseline edit when another post-intervention feature holds a value saved before BMD-1175', async () => {
    const db = makeDb()
    await setProjectFeature(db, PROJECT_ID, {
      documentKey: 'baseline',
      layer: 'habitats',
      index: 0,
      feature: validHabitat,
      unitsTotals: validUnitsTotals,
      postIntervention: {
        ...validPostInterventionDocument,
        habitats: [{ ...validPostInterventionHabitat, ref: 'R'.repeat(100) }]
      },
      actorId: ACTOR_ID
    })
    expect(db._update).toHaveBeenCalledTimes(1)
  })

  test('rejects a document that fails its schema, before writing', async () => {
    const db = makeDb()
    await expect(
      setProjectFeature(db, PROJECT_ID, {
        documentKey: 'baseline',
        layer: 'habitats',
        index: 0,
        feature: validHabitat,
        unitsTotals: validUnitsTotals,
        postIntervention: {
          ...validPostInterventionDocument,
          habitats: [{ featureId: FEATURE_ID, status: 'Nearly' }]
        },
        actorId: ACTOR_ID
      })
    ).rejects.toThrow(/failed schema validation/)
    expect(db._update).not.toHaveBeenCalled()
  })

  test('refuses to replace the document a post-intervention edit is patching', async () => {
    // Both would write the same subtree, one surgically and one wholesale.
    const db = makeDb()
    await expect(
      setProjectFeature(db, PROJECT_ID, {
        documentKey: 'postIntervention',
        layer: 'habitats',
        index: 0,
        feature: validPostInterventionHabitat,
        unitsTotals: validUnitsTotals,
        postIntervention: validPostInterventionDocument,
        actorId: ACTOR_ID
      })
    ).rejects.toThrow(/must not also replace/)
    expect(db._update).not.toHaveBeenCalled()
  })
})
