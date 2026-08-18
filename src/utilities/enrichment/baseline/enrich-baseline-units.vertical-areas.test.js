// Baseline unit enrichment for vertical area habitats (green walls /
// intertidal structures) — staged uploads only.
//
// A vertical area habitat is an AREA habitat in the metric, but it is drawn as
// a LINESTRING: its unit-bearing size is the hand-entered face Area (m²),
// stamped onto `area` at extract time, never a PostGIS measurement. The
// expected numbers below are HAND-COMPUTED from the statutory formula and the
// engine reference data, so a change in either is caught rather than mirrored:
//
//   units = (area / 10 000) × distinctivenessScore × conditionScore × strategic
//
// "Urban - Ground based green wall": distinctiveness Low → score 2
// (habitat-area-distinctiveness-categories.json); condition Moderate → score 2
// (habitat-area-condition-scores.json); baseline strategic multiplier 1.
import { describe, expect, it, vi } from 'vitest'

import { enrichBaselineDocumentWithUnits } from './enrich-baseline-units.js'

/** The fixture's VAH-1: a 150 m² ground-based green wall in Moderate condition. */
function makeVerticalArea(overrides = {}) {
  return {
    featureId: 'be0e29e5-95c1-4a0e-8b41-2e2f4f2f2a01',
    ref: 'VAH-1',
    type: 'Ground based green wall',
    broadType: 'Urban',
    condition: 'Moderate',
    status: 'Complete',
    sizeSquareMetres: 150,
    area: 150,
    ...overrides
  }
}

// 150 m² = 0.015 ha; 0.015 × 2 (Low) × 2 (Moderate) × 1 = 0.06 units.
const EXPECTED_VAH_UNITS = 0.06
const EXPECTED_LOW_SCORE = 2
const EXPECTED_MODERATE_SCORE = 2

describe('enrichBaselineDocumentWithUnits — vertical area habitats', () => {
  it('calculates units from the hand-entered face Area via the area-habitat formula', () => {
    const document = { verticalAreas: [makeVerticalArea()] }

    enrichBaselineDocumentWithUnits(document)

    const [vah] = document.verticalAreas
    expect(vah.distinctiveness).toBe('Low')
    expect(vah.distinctivenessScore).toBe(EXPECTED_LOW_SCORE)
    expect(vah.conditionScore).toBe(EXPECTED_MODERATE_SCORE)
    expect(vah.units).toBe(EXPECTED_VAH_UNITS)
    expect(vah.status).toBe('Complete')
  })

  it('totals vertical area units separately and rolls them into totalUnits', () => {
    const document = { verticalAreas: [makeVerticalArea()] }

    enrichBaselineDocumentWithUnits(document)

    expect(document.units.verticalAreasTotal).toBe(EXPECTED_VAH_UNITS)
    expect(document.units.totalUnits).toBe(EXPECTED_VAH_UNITS)
    // Not ground coverage: the parcel total must not absorb wall faces.
    expect(document.units.habitatsTotal).toBe(0)
  })

  it('omits verticalAreasTotal entirely for documents without the layer', () => {
    const document = { habitats: [] }

    enrichBaselineDocumentWithUnits(document)

    expect('verticalAreasTotal' in document.units).toBe(false)
  })

  it('yields no units, a logged note, and Incomplete status when the face Area is missing', () => {
    const logger = { warn: vi.fn() }
    const document = {
      verticalAreas: [makeVerticalArea({ area: null, sizeSquareMetres: null })]
    }

    enrichBaselineDocumentWithUnits(document, logger)

    const [vah] = document.verticalAreas
    expect(vah.units).toBeUndefined()
    expect(vah.status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no usable hand-entered face Area')
    )
    expect(document.units.verticalAreasTotal).toBe(0)
  })

  it('never crashes on a zero or non-numeric Area', () => {
    const logger = { warn: vi.fn() }
    const document = {
      verticalAreas: [
        makeVerticalArea({ area: 0 }),
        makeVerticalArea({ ref: 'VAH-2', area: 'not-a-number' })
      ]
    }

    expect(() =>
      enrichBaselineDocumentWithUnits(document, logger)
    ).not.toThrow()
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(document.units.verticalAreasTotal).toBe(0)
  })

  it('resolves the engine reference through the same broad/type candidates as parcels', () => {
    // The reference key is "Urban - Ground based green wall"; the document
    // carries broadType and type separately, exactly like an area parcel.
    const document = {
      verticalAreas: [
        makeVerticalArea({ type: 'Urban - Ground based green wall' })
      ]
    }

    enrichBaselineDocumentWithUnits(document)

    expect(document.verticalAreas[0].units).toBe(EXPECTED_VAH_UNITS)
  })
})
