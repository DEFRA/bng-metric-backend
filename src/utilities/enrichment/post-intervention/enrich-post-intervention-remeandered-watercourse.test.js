// A re-meandered watercourse in the BNG Service template (BMD-1212). The
// Metric records the total enhanced length and no loss of length, splitting
// the baseline into a retained and an enhanced section where only part is
// re-meandered (User Guide, section 7, Watercourse enhancement).

import { describe, expect, it } from 'vitest'

import { calculateEnhancedWatercoursePostIntervention } from 'bng-library/metric'

import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import { buildBaselineLinearLengthByRef } from './linear-baseline-length-by-ref.js'

const PARENT_ID = '11111111-1111-4111-8111-111111111111'
const NO_ENCROACHMENT = {
  watercourseEncroachment: 'No Encroachment',
  riparianEncroachment: 'No Encroachment/No Encroachment'
}
const LOW = 'Low'

/** The baseline "R001": 100 m of Ditches in Moderate condition. */
const PARENT = {
  featureId: PARENT_ID,
  ref: 'R001',
  type: 'Ditches',
  condition: 'Moderate',
  strategicSignificance: LOW,
  sizeMetres: 100,
  ...NO_ENCROACHMENT
}

const baselineSide = () => ({
  type: 'Ditches',
  condition: 'Moderate',
  strategicSignificance: LOW,
  ...NO_ENCROACHMENT
})

let nextId = 0

/** A post-intervention part of "R001". */
function part(retentionCategory, sizeMetres, enhancementType = null) {
  nextId += 1
  return {
    featureId: `22222222-2222-4222-8222-${String(nextId).padStart(12, '0')}`,
    parentFeatureId: PARENT_ID,
    ref: 'R001',
    retentionCategory,
    enhancementType,
    properties: { 'Enhancement Type': enhancementType },
    sizeMetres,
    units: null,
    status: 'Incomplete',
    baseline: baselineSide(),
    proposed:
      retentionCategory === 'Enhanced'
        ? {
            type: 'Ditches',
            condition: 'Good',
            strategicSignificance: LOW,
            advanceYears: 0,
            delayYears: 0,
            ...NO_ENCROACHMENT
          }
        : baselineSide()
  }
}

function enrich(watercourses) {
  const doc = { habitats: [], hedgerows: [], watercourses }
  enrichPostInterventionDocumentWithUnits(doc, undefined, {
    baselineLengthByRef: buildBaselineLinearLengthByRef([], [PARENT])
  })
  return doc
}

/** What the engine gives an enhancement of a section to a length, in metres. */
function enhancedUnits(baselineMetres, enhancedMetres) {
  return calculateEnhancedWatercoursePostIntervention(
    baselineMetres / 1000,
    enhancedMetres / 1000,
    'Ditches',
    'Ditches',
    'Moderate',
    'Good',
    { ...NO_ENCROACHMENT, strategicSignificance: LOW }
  ).units
}

describe('a re-meandered watercourse (BMD-1212)', () => {
  it('prices a whole re-meander on its 130 m and its parent’s 100 m (AC2)', () => {
    const remeandered = part('Enhanced', 130, 'Enhanced by Realignment')

    enrich([remeandered])

    expect(remeandered.status).toBe('Complete')
    expect(remeandered.length).toBe(130)
    expect(remeandered.units).toBeCloseTo(enhancedUnits(100, 130), 10)
    expect(remeandered.units).toBeGreaterThan(enhancedUnits(100, 100))
  })

  it('gives the same units whatever the Enhancement Type (AC3)', () => {
    const realigned = part('Enhanced', 130, 'Enhanced by Realignment')
    const standard = part('Enhanced', 130, 'Standard Enhancement')

    enrich([realigned])
    enrich([standard])

    expect(standard.units).toBe(realigned.units)
  })

  it('prices the Enhanced part of a split against what the Retained part leaves (AC4)', () => {
    const retained = part('Retained', 40)
    const enhanced = part('Enhanced', 90, 'Enhanced by Realignment')

    enrich([retained, enhanced])

    expect(enhanced.status).toBe('Complete')
    // The Metric's split: a 40 m retained section and a 60 m section
    // enhanced to 90 m, not 90 m of the whole parent enhanced to 90 m.
    expect(enhanced.units).toBeCloseTo(enhancedUnits(60, 90), 10)
    expect(enhanced.units).not.toBeCloseTo(enhancedUnits(90, 90), 3)
  })

  it('shares the remainder between Enhanced parts in proportion to their lengths', () => {
    const retained = part('Retained', 40)
    const first = part('Enhanced', 50)
    const second = part('Enhanced', 70)

    enrich([retained, first, second])

    expect(first.units).toBeCloseTo(enhancedUnits(25, 50), 10)
    expect(second.units).toBeCloseTo(enhancedUnits(35, 70), 10)
  })

  it('prices a shorter split on the Enhanced part’s own length, as the rest is lost', () => {
    const retained = part('Retained', 40)
    const enhanced = part('Enhanced', 50)

    enrich([retained, enhanced])

    expect(enhanced.units).toBeCloseTo(enhancedUnits(50, 50), 10)
  })

  it('prices a shorter whole enhancement on its own 80 m (AC5)', () => {
    const shorter = part('Enhanced', 80)

    enrich([shorter])

    expect(shorter.units).toBeCloseTo(enhancedUnits(80, 80), 10)
  })

  it('takes nothing from the remainder for a Created part', () => {
    const enhanced = part('Enhanced', 130)
    const created = part('Created', 20)

    enrich([enhanced, created])

    expect(enhanced.units).toBeCloseTo(enhancedUnits(100, 130), 10)
  })

  // Rule 4 (User Guide, section 3) allows habitat created in advance for
  // river re-meandering. The service uses the years as entered and does not
  // check rule 4's conditions (an open point on BMD-1212).
  it('uses the years created in advance entered on a re-meander', () => {
    const remeandered = part('Enhanced', 130, 'Enhanced by Realignment')
    remeandered.proposed.advanceYears = 5

    enrich([remeandered])

    expect(remeandered.status).toBe('Complete')
    expect(remeandered.units).toBeCloseTo(
      calculateEnhancedWatercoursePostIntervention(
        0.1,
        0.13,
        'Ditches',
        'Ditches',
        'Moderate',
        'Good',
        { ...NO_ENCROACHMENT, strategicSignificance: LOW, advanceYears: 5 }
      ).units,
      10
    )
    expect(remeandered.units).toBeGreaterThan(enhancedUnits(100, 130))
  })

  it('leaves an Enhanced part Incomplete when its Retained siblings take the whole parent', () => {
    const retained = part('Retained', 100)
    const enhanced = part('Enhanced', 30)

    enrich([retained, enhanced])

    expect(enhanced.status).toBe('Incomplete')
    expect(enhanced.units).toBeNull()
  })
})
