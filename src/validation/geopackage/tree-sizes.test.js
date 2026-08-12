import { describe, expect, it } from 'vitest'

import { treeAreaFields, summarizeTreeSizes } from './tree-sizes.js'

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

  it('returns nulls for a missing or unrecognised size', () => {
    expect(treeAreaFields(null)).toEqual({ sizeSquareMetres: null, area: null })
    expect(treeAreaFields('Gigantic')).toEqual({
      sizeSquareMetres: null,
      area: null
    })
  })
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
