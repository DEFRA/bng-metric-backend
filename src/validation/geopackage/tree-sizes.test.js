import { describe, expect, it } from 'vitest'

import {
  treeAreaFields,
  treeCountOrDefault,
  summarizeTreeSizes
} from './tree-sizes.js'

describe('treeAreaFields', () => {
  // The per-size areas come from the BNG reference data (hectares):
  // Small 0.0041, Medium 0.0163, Large 0.0366, Very large 0.0765 → m².
  it.each([
    ['Small', 41],
    ['Medium', 163],
    ['Large', 366],
    ['Very large', 765]
  ])('returns the notional m² area for a %s tree', (treeSize, expected) => {
    expect(treeAreaFields(treeSize)).toEqual({
      sizeSquareMetres: expected,
      area: expected
    })
  })

  it('multiplies the per-tree area by the number of trees the point stands for', () => {
    // A Medium point with a Count of 3 is three Medium trees: 3 × 0.0163 ha.
    expect(treeAreaFields('Medium', 3)).toEqual({
      sizeSquareMetres: 489,
      area: 489
    })
    expect(treeAreaFields('Small', '4')).toEqual({
      sizeSquareMetres: 164,
      area: 164
    })
  })

  it.each([undefined, null, '', 0, -2, 'many'])(
    'prices a point whose Count is %j as one tree',
    (count) => {
      expect(treeAreaFields('Large', count)).toEqual({
        sizeSquareMetres: 366,
        area: 366
      })
    }
  )

  it('returns nulls for a missing or unrecognised size whatever the count', () => {
    expect(treeAreaFields(null, 3)).toEqual({
      sizeSquareMetres: null,
      area: null
    })
  })

  it('returns nulls for a missing or unrecognised size', () => {
    expect(treeAreaFields(null)).toEqual({ sizeSquareMetres: null, area: null })
    expect(treeAreaFields('Gigantic')).toEqual({
      sizeSquareMetres: null,
      area: null
    })
  })
})

describe('treeCountOrDefault', () => {
  it('reads a positive count, as a number or numeric text', () => {
    expect(treeCountOrDefault(3)).toBe(3)
    expect(treeCountOrDefault('2')).toBe(2)
  })

  // Only a blank reaches here from an upload; the rest are refused by
  // tree-count-check.js first, and default defensively.
  it.each([undefined, null, '', 0, -1, 2.5, 'two', Number.NaN])(
    'defaults %j to one tree',
    (count) => {
      expect(treeCountOrDefault(count)).toBe(1)
    }
  )
})

describe('summarizeTreeSizes', () => {
  it('sums sizes overall and by urban/rural via the supplied type resolver', () => {
    const trees = [
      { sizeSquareMetres: 163, proposed: { type: 'Urban tree' } },
      { sizeSquareMetres: 41, proposed: { type: 'Rural tree' } },
      { sizeSquareMetres: null, proposed: { type: 'Urban tree' } }
    ]
    expect(summarizeTreeSizes(trees, (t) => t.proposed?.type)).toEqual({
      totalSquareMetres: 204,
      urbanSquareMetres: 163,
      ruralSquareMetres: 41
    })
  })

  it('counts an unknown type toward the total but not the urban/rural split', () => {
    const trees = [{ sizeSquareMetres: 100, type: null }]
    expect(summarizeTreeSizes(trees, (t) => t.type)).toEqual({
      totalSquareMetres: 100,
      urbanSquareMetres: 0,
      ruralSquareMetres: 0
    })
  })
})
