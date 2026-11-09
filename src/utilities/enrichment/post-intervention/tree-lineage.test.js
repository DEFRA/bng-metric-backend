import { describe, expect, it } from 'vitest'

import { alignTreesWithParents } from './tree-lineage.js'

const PARENT_ID = '00000000-0000-4000-8000-000000000001'

/** A baseline tree: three Medium Rural trees, native, in Moderate condition. */
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
  count: 3,
  sizeSquareMetres: 489,
  area: 489
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
    count: 2,
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
  it('keeps a Retained tree as its parent was, priced for its own Count', () => {
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
      sizeSquareMetres: 326,
      area: 326
    })
    expect(tree.baseline).toMatchObject({
      treeSize: 'Medium',
      condition: 'Moderate',
      sizeSquareMetres: 326
    })
    expect(tree).toMatchObject({ sizeSquareMetres: 326, area: 326 })
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
      sizeSquareMetres: 326
    })
    expect(tree.baseline.condition).toBe('Moderate')
  })

  it('prices a tree with a blank Count as one tree', () => {
    const tree = piTree('Retained', { count: null })

    align(tree)

    expect(tree.sizeSquareMetres).toBe(163)
  })

  it('leaves a Created tree, linked or not, at its planted size', () => {
    const linked = piTree('Created')
    const unlinked = piTree('Created', { parentFeatureId: undefined })
    const before = structuredClone([linked, unlinked])

    expect(
      alignTreesWithParents(
        { trees: [linked, unlinked] },
        { trees: [parent()] }
      )
    ).toEqual([])
    expect([linked, unlinked]).toEqual(before)
  })

  it('leaves a tree whose parent is not in the baseline', () => {
    const tree = piTree('Retained')

    expect(alignTreesWithParents({ trees: [tree] }, { trees: [] })).toEqual([])
    expect(tree.proposed.treeSize).toBe('Very large')
  })
})
