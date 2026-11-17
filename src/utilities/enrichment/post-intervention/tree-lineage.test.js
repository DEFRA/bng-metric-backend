import { describe, expect, it } from 'vitest'

import {
  alignTreesWithParents,
  refreshTreeHabitatSizes
} from './tree-lineage.js'

const PARENT_ID = '00000000-0000-4000-8000-000000000001'

/** A baseline tree: one Medium Rural tree, native, in Moderate condition. */
const parent = () => ({
  featureId: PARENT_ID,
  ref: 'T001',
  type: 'Rural tree',
  broadType: 'Individual trees',
  treeSize: 'Medium',
  treeSpecies: 'Native',
  ruralOrUrban: 'Rural tree',
  condition: 'Moderate',
  strategicSignificance: 'Low',
  sizeSquareMetres: 163,
  area: 163
})

/** A post-intervention tree whose Proposed columns say it grew and moved. */
function piTree(retentionCategory, overrides = {}) {
  const grown = {
    type: 'Urban tree',
    broadType: 'Individual trees',
    treeSize: 'Very large',
    treeSpecies: 'Non-native',
    ruralOrUrban: 'Urban tree',
    condition: 'Good',
    strategicSignificance: 'High',
    sizeSquareMetres: 1530,
    area: 1530
  }
  return {
    featureId: 'pi-1',
    parentFeatureId: PARENT_ID,
    retentionCategory,
    sizeSquareMetres: 1530,
    area: 1530,
    baseline: { ...grown, strategicSignificance: 'Low' },
    proposed: grown,
    ...overrides
  }
}

const align = (tree) =>
  alignTreesWithParents({ trees: [tree] }, { trees: [parent()] })

describe('alignTreesWithParents', () => {
  it('keeps a Retained tree as its parent was, priced as one tree', () => {
    const tree = piTree('Retained')

    expect(align(tree)).toEqual([tree])
    expect(tree.proposed).toEqual({
      type: 'Rural tree',
      broadType: 'Individual trees',
      treeSize: 'Medium',
      treeSpecies: 'Native',
      ruralOrUrban: 'Rural tree',
      condition: 'Moderate',
      strategicSignificance: 'Low',
      sizeSquareMetres: 163,
      area: 163
    })
    expect(tree.baseline).toMatchObject({
      treeSize: 'Medium',
      condition: 'Moderate',
      sizeSquareMetres: 163
    })
    expect(tree).toMatchObject({ sizeSquareMetres: 163, area: 163 })
  })

  it('keeps an Enhanced tree’s size, type and setting, but the condition and significance it proposes', () => {
    const tree = piTree('Enhanced')

    align(tree)

    expect(tree.proposed).toMatchObject({
      type: 'Rural tree',
      treeSize: 'Medium',
      treeSpecies: 'Native',
      ruralOrUrban: 'Rural tree',
      condition: 'Good',
      strategicSignificance: 'High',
      sizeSquareMetres: 163
    })
    expect(tree.baseline.condition).toBe('Moderate')
  })

  it('leaves a Newly Planted tree, linked or not, at its planted size', () => {
    const planted = { properties: { Category: 'Newly Planted' } }
    const linked = piTree('Created', planted)
    const unlinked = piTree('Created', {
      ...planted,
      parentFeatureId: undefined
    })
    const before = structuredClone([linked, unlinked])

    expect(
      alignTreesWithParents(
        { trees: [linked, unlinked] },
        { trees: [parent()] }
      )
    ).toEqual([])
    expect([linked, unlinked]).toEqual(before)
  })

  it('keeps a degraded tree’s size, type and setting, but the condition and timing it proposes', () => {
    const tree = piTree('Created', {
      properties: { Category: 'Existing' },
      proposed: {
        type: 'Rural tree',
        broadType: 'Individual trees',
        treeSize: 'Very large',
        treeSpecies: 'Non-native',
        ruralOrUrban: 'Rural tree',
        condition: 'Poor',
        strategicSignificance: 'Low',
        advanceYears: 30
      }
    })

    expect(align(tree)).toEqual([tree])
    expect(tree.proposed).toMatchObject({
      type: 'Rural tree',
      treeSize: 'Medium',
      treeSpecies: 'Native',
      ruralOrUrban: 'Rural tree',
      condition: 'Poor',
      advanceYears: 30,
      sizeSquareMetres: 163
    })
    expect(tree.baseline.condition).toBe('Moderate')
  })

  it('reads a degraded tree with a blank proposed setting as in its baseline setting, as the file check does', () => {
    const tree = piTree('Created', {
      properties: { Category: 'Existing' },
      baseline: { type: 'Rural tree', broadType: 'Individual trees' },
      proposed: {
        type: null,
        broadType: 'Individual trees',
        treeSize: null,
        ruralOrUrban: null,
        condition: 'Poor'
      }
    })

    expect(align(tree)).toEqual([tree])
    expect(tree.proposed).toMatchObject({
      type: 'Rural tree',
      treeSize: 'Medium',
      condition: 'Poor',
      sizeSquareMetres: 163
    })
  })

  it('leaves an Existing tree Created in the other setting: it is a creation in that setting', () => {
    const tree = piTree('Created', { properties: { Category: 'Existing' } })
    const before = structuredClone(tree)

    expect(align(tree)).toEqual([])
    expect(tree).toEqual(before)
  })

  it('leaves a tree whose parent is not in the baseline', () => {
    const tree = piTree('Retained')

    expect(alignTreesWithParents({ trees: [tree] }, { trees: [] })).toEqual([])
    expect(tree.proposed.treeSize).toBe('Very large')
  })
})

describe('refreshTreeHabitatSizes', () => {
  it('sums the trees as they are kept, and the area habitats with them', () => {
    const document = {
      trees: [
        { sizeSquareMetres: 326, proposed: { type: 'Rural tree' } },
        { sizeSquareMetres: 41, proposed: { type: 'Urban tree' } },
        { sizeSquareMetres: null, proposed: { type: 'Urban tree' } }
      ],
      habitatSizes: {
        areaHabitats: { totalSquareMetres: 99999 },
        site: { totalSquareMetres: 10000 },
        trees: {
          totalSquareMetres: 1530,
          urbanSquareMetres: 1530,
          ruralSquareMetres: 0
        },
        verticalHabitats: { totalSquareMetres: 40 },
        hedgerows: { totalMetres: 5 }
      }
    }

    refreshTreeHabitatSizes(document)

    expect(document.habitatSizes).toEqual({
      areaHabitats: { totalSquareMetres: 10407 },
      site: { totalSquareMetres: 10000 },
      trees: {
        totalSquareMetres: 367,
        urbanSquareMetres: 41,
        ruralSquareMetres: 326
      },
      verticalHabitats: { totalSquareMetres: 40 },
      hedgerows: { totalMetres: 5 }
    })
  })

  it('leaves a document with no habitat sizes without them', () => {
    const document = { trees: [] }

    refreshTreeHabitatSizes(document)

    expect(document).toEqual({ trees: [] })
  })
})
