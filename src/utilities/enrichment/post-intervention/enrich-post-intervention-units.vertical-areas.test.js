// Post-intervention unit enrichment for vertical area habitats — the Enhanced
// green wall the staged fixture carries, end to end through the ordinary
// area-habitat dispatch.
//
// The expected number is HAND-COMPUTED from the statutory enhancement formula
// and the engine reference data, so a change in either is caught rather than
// mirrored. For the fixture's VAH-1 (250 m², "Urban - Ground based green wall"
// Moderate → "Urban - Facade-bound green wall" Good, no advance, no delay):
//
//   size               250 m² = 0.025 ha
//   baseline value     0.025 × 2 (Low) × 2 (Moderate)        = 0.10
//   proposed value     0.025 × 2 (Low) × 3 (Good)            = 0.15
//   time multiplier    2 years to target → 0.965²            = 0.931225
//     (habitat-area-time-to-target-enhancement.json, Facade-bound green wall,
//      Lower Distinctiveness Habitat - Moderate → Good)
//   difficulty         Medium → 0.67 (habitat-area-difficulty.json)
//   units = (0.15 − 0.10) × (0.931225 × 0.67) + 0.10 = 0.1311960375
import { describe, expect, it, vi } from 'vitest'

import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'

/** The fixture's post-intervention VAH-1, as extract-post-intervention builds it. */
function makeEnhancedVerticalArea(overrides = {}) {
  return {
    featureId: 'be0e29e5-95c1-4a0e-8b41-2e2f4f2f2a02',
    ref: 'VAH-1',
    retentionCategory: 'Enhanced',
    area: 250,
    sizeSquareMetres: 250,
    units: null,
    status: 'Complete',
    baseline: {
      type: 'Ground based green wall',
      broadType: 'Urban',
      condition: 'Moderate',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null
    },
    proposed: {
      type: 'Facade-bound green wall',
      broadType: 'Urban',
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null,
      advanceYears: 0,
      delayYears: 0
    },
    ...overrides
  }
}

const EXPECTED_ENHANCED_VAH_UNITS = 0.1311960375
const EXPECTED_TIME_MULTIPLIER = 0.931225
const EXPECTED_DIFFICULTY_MULTIPLIER = 0.67
const EXPECTED_GOOD_SCORE = 3

describe('enrichPostInterventionDocumentWithUnits — vertical area habitats', () => {
  it('calculates Enhanced units from the hand-entered face Area via the area dispatch', () => {
    const document = { verticalAreas: [makeEnhancedVerticalArea()] }

    enrichPostInterventionDocumentWithUnits(document)

    const [vah] = document.verticalAreas
    expect(vah.units).toBe(EXPECTED_ENHANCED_VAH_UNITS)
    expect(vah.status).toBe('Complete')
    expect(vah.proposed.distinctiveness).toBe('Low')
    expect(vah.proposed.conditionScore).toBe(EXPECTED_GOOD_SCORE)
    expect(vah.proposed.timeMultiplier).toBe(EXPECTED_TIME_MULTIPLIER)
    expect(vah.proposed.difficultyMultiplier).toBe(
      EXPECTED_DIFFICULTY_MULTIPLIER
    )
  })

  it('totals vertical area units separately and rolls them into totalUnits', () => {
    const document = { verticalAreas: [makeEnhancedVerticalArea()] }

    enrichPostInterventionDocumentWithUnits(document)

    expect(document.units.verticalAreasTotal).toBe(EXPECTED_ENHANCED_VAH_UNITS)
    expect(document.units.totalUnits).toBe(EXPECTED_ENHANCED_VAH_UNITS)
    expect(document.units.habitatsTotal).toBe(0)
  })

  it('keeps vertical areas out of the engine net-change figures', () => {
    // calculatePostInterventionNetUnitChanges reads habitats/trees/hedgerows/
    // watercourses totals only; verticalAreasTotal must not distort them.
    const document = { verticalAreas: [makeEnhancedVerticalArea()] }

    enrichPostInterventionDocumentWithUnits(
      document,
      { warn: vi.fn() },
      {
        baselineUnits: {
          habitatsTotal: 0,
          treesTotal: 0,
          hedgerowsTotal: 0,
          watercoursesTotal: 0,
          verticalAreasTotal: 0.06
        }
      }
    )

    expect(document.units.habitatsNetUnitChange).toBe(0)
  })

  it('yields no units, a logged note, and Incomplete status when the face Area is missing', () => {
    const logger = { warn: vi.fn() }
    const document = {
      verticalAreas: [
        makeEnhancedVerticalArea({ area: null, sizeSquareMetres: null })
      ]
    }

    enrichPostInterventionDocumentWithUnits(document, logger)

    const [vah] = document.verticalAreas
    expect(vah.units).toBeNull()
    expect(vah.status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no usable hand-entered face Area')
    )
    expect(document.units.verticalAreasTotal).toBe(0)
  })
})
