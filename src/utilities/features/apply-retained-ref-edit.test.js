import { describe, test, expect, vi } from 'vitest'

import {
  RETAINED_REF_RESULT,
  applyRetainedRefEdit
} from './apply-retained-ref-edit.js'

const BASELINE_HABITAT_ID = 'aa0e8400-e29b-41d4-a716-446655440001'
const BASELINE_HEDGEROW_ID = 'bb0e8400-e29b-41d4-a716-446655440002'
const BASELINE_WATERCOURSE_ID = 'cc0e8400-e29b-41d4-a716-446655440003'
const PI_HABITAT_ID = 'dd0e8400-e29b-41d4-a716-446655440004'
const PI_HEDGEROW_ID = 'ee0e8400-e29b-41d4-a716-446655440005'
const PI_WATERCOURSE_ID = 'ff0e8400-e29b-41d4-a716-446655440006'
const PI_SPLIT_ID = 'aa1e8400-e29b-41d4-a716-446655440007'
const SECOND_BASELINE_HABITAT_ID = 'aa2e8400-e29b-41d4-a716-446655440008'

const MAX_REF_LENGTH = 100

const AREA_IDENTITY = {
  type: 'Modified grassland',
  broadType: 'Grassland',
  condition: 'Poor'
}

function retainedHabitat(featureId, ref, identity = AREA_IDENTITY) {
  return {
    featureId,
    ref,
    retentionCategory: 'Retained',
    area: 10_000,
    sizeSquareMetres: 10_000,
    units: 4,
    status: 'Complete',
    baseline: { ...identity },
    proposed: { ...identity, advanceYears: 0, delayYears: 0 }
  }
}

function projectFixture() {
  return {
    name: 'Fixture',
    baseline: {
      habitats: [
        {
          featureId: BASELINE_HABITAT_ID,
          ref: 'A1',
          ...AREA_IDENTITY,
          sizeSquareMetres: 10_000,
          units: 4
        }
      ],
      trees: [],
      hedgerows: [
        {
          featureId: BASELINE_HEDGEROW_ID,
          ref: 'H1',
          type: 'Native hedgerow',
          condition: 'Good',
          sizeMetres: 1000,
          units: 6
        }
      ],
      watercourses: [
        {
          featureId: BASELINE_WATERCOURSE_ID,
          ref: 'W1',
          type: 'Ditches',
          condition: 'Good',
          sizeMetres: 500,
          units: 3
        }
      ],
      units: {
        totalUnits: 13,
        habitatsTotal: 4,
        hedgerowsTotal: 6,
        watercoursesTotal: 3
      }
    },
    postIntervention: {
      habitats: [retainedHabitat(PI_HABITAT_ID, 'A1')],
      trees: [],
      hedgerows: [
        {
          featureId: PI_HEDGEROW_ID,
          ref: 'H1',
          retentionCategory: 'Retained',
          sizeMetres: 1000,
          units: 6,
          status: 'Complete',
          baseline: { type: 'Native hedgerow', condition: 'Good' },
          proposed: {
            type: 'Native hedgerow',
            condition: 'Good',
            advanceYears: 0,
            delayYears: 0
          }
        }
      ],
      watercourses: [
        {
          featureId: PI_WATERCOURSE_ID,
          ref: 'W1',
          retentionCategory: 'Retained',
          sizeMetres: 500,
          units: 3,
          status: 'Complete',
          baseline: { type: 'Ditches', condition: 'Good' },
          proposed: {
            type: 'Ditches',
            condition: 'Good',
            advanceYears: 0,
            delayYears: 0
          }
        }
      ],
      units: { totalUnits: 13, habitatsTotal: 4 }
    }
  }
}

function stubLogger() {
  return { warn: vi.fn() }
}

describe('applyRetainedRefEdit — renaming through the baseline parcel', () => {
  test('renames the baseline parcel and the retained area habitat joined to it', () => {
    const result = applyRetainedRefEdit(projectFixture(), {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result).toMatchObject({
      status: RETAINED_REF_RESULT.OK,
      type: 'habitat',
      documentKey: 'baseline',
      layer: 'habitats',
      index: 0
    })
    expect(result.feature).toMatchObject({
      featureId: BASELINE_HABITAT_ID,
      ref: 'P-A1',
      ...AREA_IDENTITY
    })
    expect(result.postIntervention.habitats[0].ref).toBe('P-A1')
    expect(result.postInterventionFeature).toMatchObject({
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })
  })

  test('carries the rename onto every post-intervention row split from the parcel', () => {
    const project = projectFixture()
    project.postIntervention.habitats.push(retainedHabitat(PI_SPLIT_ID, 'A1'))

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result.postIntervention.habitats.map((row) => row.ref)).toEqual([
      'P-A1',
      'P-A1'
    ])
  })

  test('renames a retained hedgerow and its baseline hedgerow', () => {
    const result = applyRetainedRefEdit(projectFixture(), {
      featureId: PI_HEDGEROW_ID,
      ref: 'P-H1'
    })

    expect(result).toMatchObject({
      type: 'hedgerow',
      documentKey: 'baseline',
      layer: 'hedgerows'
    })
    expect(result.feature).toMatchObject({
      featureId: BASELINE_HEDGEROW_ID,
      ref: 'P-H1'
    })
    expect(result.postInterventionFeature.ref).toBe('P-H1')
  })

  test('renames a retained watercourse and its baseline watercourse', () => {
    const result = applyRetainedRefEdit(projectFixture(), {
      featureId: PI_WATERCOURSE_ID,
      ref: 'P-W1'
    })

    expect(result).toMatchObject({
      type: 'watercourse',
      documentKey: 'baseline',
      layer: 'watercourses'
    })
    expect(result.feature.ref).toBe('P-W1')
    expect(result.postInterventionFeature.ref).toBe('P-W1')
  })

  test('leaves the other layers and the stored project untouched', () => {
    const project = projectFixture()
    const before = structuredClone(project)

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(project).toEqual(before)
    expect(result.postIntervention.hedgerows[0].ref).toBe('H1')
    expect(result.postIntervention.watercourses[0].ref).toBe('W1')
  })

  test('hands back the baseline unit totals to write with the parcel', () => {
    const result = applyRetainedRefEdit(projectFixture(), {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result.unitsTotals).toMatchObject({
      totalUnits: 13,
      habitatsTotal: 4,
      hedgerowsTotal: 6,
      watercoursesTotal: 3
    })
  })

  test('trims the reference and truncates it to 100 characters, as an import does (BMD-1058)', () => {
    const result = applyRetainedRefEdit(projectFixture(), {
      featureId: PI_HABITAT_ID,
      ref: `  ${'x'.repeat(120)}  `
    })

    expect(result.feature.ref).toBe('x'.repeat(MAX_REF_LENGTH))
    expect(result.postInterventionFeature.ref).toBe('x'.repeat(MAX_REF_LENGTH))
  })

  test('picks out a parcel that shares its ref by the row’s imported values', () => {
    const project = projectFixture()
    const otherIdentity = {
      type: 'Other neutral grassland',
      broadType: 'Grassland',
      condition: 'Good'
    }
    project.baseline.habitats.push({
      featureId: SECOND_BASELINE_HABITAT_ID,
      ref: 'A1',
      ...otherIdentity,
      sizeSquareMetres: 10_000,
      units: 8
    })
    project.postIntervention.habitats.push(
      retainedHabitat(PI_SPLIT_ID, 'A1', otherIdentity)
    )

    const result = applyRetainedRefEdit(project, {
      featureId: PI_SPLIT_ID,
      ref: 'P-A1'
    })

    expect(result.documentKey).toBe('baseline')
    expect(result.feature.featureId).toBe(SECOND_BASELINE_HABITAT_ID)
    expect(result.index).toBe(1)
    expect(result.postIntervention.habitats.map((row) => row.ref)).toEqual([
      'A1',
      'P-A1'
    ])
  })
})

describe('applyRetainedRefEdit — renaming the row alone', () => {
  test('renames only the row when it is linked to its parent by id (BNG Service template)', () => {
    const project = projectFixture()
    project.postIntervention.habitats[0].parentFeatureId = BASELINE_HABITAT_ID

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result).toMatchObject({
      status: RETAINED_REF_RESULT.OK,
      documentKey: 'postIntervention',
      layer: 'habitats',
      index: 0,
      postIntervention: null
    })
    expect(result.feature).toMatchObject({
      featureId: PI_HABITAT_ID,
      ref: 'P-A1',
      parentFeatureId: BASELINE_HABITAT_ID
    })
    expect(result.postInterventionFeature).toBe(result.feature)
  })

  test('renames only the row, and says so, when no baseline parcel carries its ref', () => {
    const project = projectFixture()
    project.baseline.habitats[0].ref = 'Z9'
    const logger = stubLogger()

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1',
      logger
    })

    expect(result.documentKey).toBe('postIntervention')
    expect(result.feature.ref).toBe('P-A1')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no baseline feature carries ref "A1"')
    )
  })

  test('renames only the row when parcels sharing its ref cannot be told apart', () => {
    const project = projectFixture()
    project.baseline.habitats.push({
      ...project.baseline.habitats[0],
      featureId: SECOND_BASELINE_HABITAT_ID
    })
    const logger = stubLogger()

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1',
      logger
    })

    expect(result.documentKey).toBe('postIntervention')
    expect(result.feature.ref).toBe('P-A1')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('so only this post-intervention row is renamed')
    )
  })

  test('renames only the row when the project has no baseline document', () => {
    const project = projectFixture()
    delete project.baseline

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result.documentKey).toBe('postIntervention')
    expect(result.feature.ref).toBe('P-A1')
  })
})

describe('applyRetainedRefEdit — edits it turns away', () => {
  test('says the feature was not found when no post-intervention row has the id', () => {
    const result = applyRetainedRefEdit(projectFixture(), {
      featureId: BASELINE_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result).toEqual({ status: RETAINED_REF_RESULT.FEATURE_NOT_FOUND })
  })

  test('says the feature was not found when the project has no post-intervention document', () => {
    const project = projectFixture()
    delete project.postIntervention

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result.status).toBe(RETAINED_REF_RESULT.FEATURE_NOT_FOUND)
  })

  test.each(['Enhanced', 'Created'])(
    'refuses a %s habitat',
    (retentionCategory) => {
      const project = projectFixture()
      project.postIntervention.habitats[0].retentionCategory = retentionCategory

      const result = applyRetainedRefEdit(project, {
        featureId: PI_HABITAT_ID,
        ref: 'P-A1'
      })

      expect(result).toEqual({
        status: RETAINED_REF_RESULT.NOT_RETAINED,
        type: 'habitat'
      })
    }
  )

  test('refuses an individual tree, whose reference is not editable', () => {
    const project = projectFixture()
    project.postIntervention.trees.push({
      ...retainedHabitat(PI_SPLIT_ID, 'T1'),
      type: 'Urban tree'
    })

    const result = applyRetainedRefEdit(project, {
      featureId: PI_SPLIT_ID,
      ref: 'P-T1'
    })

    expect(result).toEqual({
      status: RETAINED_REF_RESULT.NOT_RETAINED,
      type: 'tree'
    })
  })
})

describe('applyRetainedRefEdit — the totals written with a row renamed alone', () => {
  test('recomputes them, so a document stored without the tree totals still saves', () => {
    const project = projectFixture()
    project.postIntervention.habitats[0].parentFeatureId = BASELINE_HABITAT_ID
    // Stored before the tree totals existed.
    project.postIntervention.units = { totalUnits: 13, habitatsTotal: 4 }

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result.unitsTotals).toMatchObject({
      totalUnits: 13,
      habitatsTotal: 4,
      hedgerowsTotal: 6,
      watercoursesTotal: 3,
      treesTotal: 0,
      treesUrbanTotal: 0,
      treesRuralTotal: 0
    })
    // Measured against the stored baseline totals, as an edit refreshes them.
    expect(result.unitsTotals).toHaveProperty('habitatsNetUnitChange', 0)
  })

  test('recomputes them when the document has none at all', () => {
    const project = projectFixture()
    project.postIntervention.habitats[0].parentFeatureId = BASELINE_HABITAT_ID
    delete project.postIntervention.units

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result.unitsTotals.totalUnits).toBe(13)
  })
})

describe('applyRetainedRefEdit — a reference another baseline habitat carries', () => {
  function withSecondArea(project) {
    project.baseline.habitats.push({
      featureId: SECOND_BASELINE_HABITAT_ID,
      ref: 'A2',
      type: 'Other neutral grassland',
      broadType: 'Grassland',
      condition: 'Good',
      sizeSquareMetres: 10_000,
      units: 8
    })
    return project
  }

  test('refuses to rename an area habitat onto another area habitat’s reference', () => {
    const project = withSecondArea(projectFixture())
    const before = structuredClone(project)

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: ' A2 '
    })

    expect(result).toEqual({
      status: RETAINED_REF_RESULT.REF_IN_USE,
      type: 'habitat',
      ref: 'A2'
    })
    expect(project).toEqual(before)
  })

  test('refuses to rename a hedgerow onto a watercourse’s reference: their lengths share one map', () => {
    const result = applyRetainedRefEdit(projectFixture(), {
      featureId: PI_HEDGEROW_ID,
      ref: 'W1'
    })

    expect(result).toEqual({
      status: RETAINED_REF_RESULT.REF_IN_USE,
      type: 'hedgerow',
      ref: 'W1'
    })
  })

  test('lets a row with no parcel be renamed onto a parcel’s reference, repairing its join', () => {
    const project = withSecondArea(projectFixture())
    project.baseline.habitats[0].ref = 'Z9'

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'A2'
    })

    expect(result).toMatchObject({
      status: RETAINED_REF_RESULT.OK,
      documentKey: 'postIntervention',
      feature: { featureId: PI_HABITAT_ID, ref: 'A2' }
    })
  })

  test('lets a template row take its own parent’s reference', () => {
    const project = projectFixture()
    project.postIntervention.habitats[0].ref = 'P-A1'
    project.postIntervention.habitats[0].parentFeatureId = BASELINE_HABITAT_ID

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'A1'
    })

    expect(result.status).toBe(RETAINED_REF_RESULT.OK)
    expect(result.feature.ref).toBe('A1')
  })

  test('lets an area habitat take a reference only a hedgerow carries', () => {
    const result = applyRetainedRefEdit(projectFixture(), {
      featureId: PI_HABITAT_ID,
      ref: 'H1'
    })

    expect(result.status).toBe(RETAINED_REF_RESULT.OK)
  })

  test('saves the reference unchanged even where an import shared it', () => {
    const project = projectFixture()
    project.baseline.habitats.push({
      ...project.baseline.habitats[0],
      featureId: SECOND_BASELINE_HABITAT_ID,
      type: 'Other neutral grassland'
    })

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'A1'
    })

    expect(result.status).toBe(RETAINED_REF_RESULT.OK)
  })
})

describe('applyRetainedRefEdit — a BNG Service template upload', () => {
  test('renames a template row alone, even one naming no parent', () => {
    const project = projectFixture()
    project.postIntervention.template = { name: 'BNG Service template' }

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result).toMatchObject({
      status: RETAINED_REF_RESULT.OK,
      documentKey: 'postIntervention',
      postIntervention: null,
      feature: { featureId: PI_HABITAT_ID, ref: 'P-A1' }
    })
  })
})

describe('applyRetainedRefEdit — a row stored with its category under baseline', () => {
  function legacyRow(project) {
    const row = project.postIntervention.habitats[0]
    delete row.retentionCategory
    row.baseline.retentionCategory = '1. Retained'
    return project
  }

  test('moves the category to the root of a row renamed alone', () => {
    const project = legacyRow(projectFixture())
    project.baseline.habitats[0].ref = 'Z9'

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result.feature.retentionCategory).toBe('Retained')
    expect(result.feature.baseline).not.toHaveProperty('retentionCategory')
  })

  test('moves the category to the root of every row re-derived through the baseline', () => {
    const project = legacyRow(projectFixture())

    const result = applyRetainedRefEdit(project, {
      featureId: PI_HABITAT_ID,
      ref: 'P-A1'
    })

    expect(result.documentKey).toBe('baseline')
    expect(result.postInterventionFeature).toMatchObject({
      ref: 'P-A1',
      retentionCategory: 'Retained'
    })
    expect(result.postInterventionFeature.baseline).not.toHaveProperty(
      'retentionCategory'
    )
  })
})
