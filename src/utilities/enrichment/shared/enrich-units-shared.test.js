import { describe, it, expect, vi } from 'vitest'

import {
  enrichCollectionIfNonEmpty,
  NO_OP_LOGGER,
  pricedAreaHectares,
  pricedLengthKm
} from './enrich-units-shared.js'

describe('enrichCollectionIfNonEmpty', () => {
  it('calls enricher for each item in a non-empty collection', () => {
    const enricher = vi.fn()
    enrichCollectionIfNonEmpty([{ id: 1 }, { id: 2 }], enricher, NO_OP_LOGGER)

    expect(enricher).toHaveBeenCalledTimes(2)
  })

  it('does nothing when collection is empty', () => {
    const enricher = vi.fn()
    enrichCollectionIfNonEmpty([], enricher, NO_OP_LOGGER)

    expect(enricher).not.toHaveBeenCalled()
  })

  it('does nothing when collection is undefined', () => {
    const enricher = vi.fn()
    enrichCollectionIfNonEmpty(undefined, enricher, NO_OP_LOGGER)

    expect(enricher).not.toHaveBeenCalled()
  })
})

describe('pricedAreaHectares', () => {
  it('prices the measured size, unrounded, not the rounded display area', () => {
    expect(
      pricedAreaHectares({ sizeSquareMetres: 144_529.08, area: 144_529 })
    ).toBeCloseTo(14.452908, 12)
  })

  it('falls back to the rounded area when no measured size is stored', () => {
    expect(pricedAreaHectares({ area: 5000 })).toBe(0.5)
    expect(pricedAreaHectares({ sizeSquareMetres: null, area: 5000 })).toBe(0.5)
  })

  it('returns null when neither size is positive', () => {
    expect(pricedAreaHectares({})).toBeNull()
    expect(pricedAreaHectares({ sizeSquareMetres: 0, area: 0 })).toBeNull()
    expect(pricedAreaHectares({ sizeSquareMetres: Number.NaN })).toBeNull()
  })
})

describe('pricedLengthKm', () => {
  it('converts metres to kilometres without rounding', () => {
    expect(pricedLengthKm(500.7)).toBe(0.5007)
  })
})
