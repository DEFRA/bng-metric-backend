import { describe, expect, it, vi } from 'vitest'

import {
  LOST_OUTCOME,
  applyLineageOutcomes,
  lostBaselineHabitats,
  nullDisallowedWatercourseAdvance
} from './lineage-outcomes.js'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const DITCH = {
  type: 'Ditches',
  condition: 'Moderate',
  watercourseEncroachment: 'No Encroachment',
  riparianEncroachment: 'No Encroachment/No Encroachment'
}

function parcel(n, sizeSquareMetres = 1000) {
  return {
    featureId: id(n),
    ref: `H00${n}`,
    type: 'Other neutral grassland',
    broadType: 'Grassland',
    condition: 'Moderate',
    sizeSquareMetres
  }
}

const line = (n, sizeMetres, overrides = {}) => ({
  featureId: id(n),
  ref: `L00${n}`,
  type: 'Native hedgerow',
  condition: 'Good',
  sizeMetres,
  ...overrides
})

/** A post-intervention feature linked to `parent`. */
function child(n, parent, retentionCategory, size, proposed = {}) {
  const sizeField =
    'sizeSquareMetres' in parent ? 'sizeSquareMetres' : 'sizeMetres'
  return {
    featureId: id(100 + n),
    parentFeatureId: parent.featureId,
    retentionCategory,
    [sizeField]: size,
    proposed: { type: parent.type, condition: parent.condition, ...proposed }
  }
}

describe('lostBaselineHabitats', () => {
  it('records nothing for a parent its Retained and Enhanced children keep whole', () => {
    const area = parcel(1)
    const hedge = line(2, 100)

    expect(
      lostBaselineHabitats(
        {
          habitats: [
            child(1, area, 'Retained', 600),
            child(2, area, 'Enhanced', 400)
          ],
          hedgerows: [child(3, hedge, 'Retained', 100)]
        },
        { habitats: [area], hedgerows: [hedge] }
      )
    ).toEqual([])
  })

  it('records a parent no post-intervention habitat names as removed, in full', () => {
    const ditch = line(1, 120, { ref: 'R001', type: 'Ditches' })

    expect(lostBaselineHabitats({}, { watercourses: [ditch] })).toEqual([
      {
        layer: 'watercourses',
        featureId: ditch.featureId,
        ref: 'R001',
        type: 'Ditches',
        outcome: LOST_OUTCOME.removed,
        lostSizeMetres: 120,
        recreatedAs: []
      }
    ])
  })

  it('records a parent with a Created child of its own type as lost and re-created, less what is retained', () => {
    const hedge = line(1, 100)
    const worse = child(2, hedge, 'Created', 40, { condition: 'Poor' })

    expect(
      lostBaselineHabitats(
        { hedgerows: [child(1, hedge, 'Retained', 60), worse] },
        { hedgerows: [hedge] }
      )
    ).toEqual([
      expect.objectContaining({
        outcome: LOST_OUTCOME.lostAndRecreated,
        lostSizeMetres: 40,
        recreatedAs: [worse.featureId]
      })
    ])
  })

  it('finds a Created child of its parent’s type re-creating it whichever form each names it in', () => {
    const area = {
      ...parcel(1),
      type: 'Grassland - Other neutral grassland'
    }

    const [lost] = lostBaselineHabitats(
      {
        habitats: [
          child(1, area, 'Created', 1000, {
            type: 'Other neutral grassland',
            broadType: 'Grassland'
          })
        ]
      },
      { habitats: [area] }
    )

    expect(lost).toEqual(
      expect.objectContaining({
        outcome: LOST_OUTCOME.lostAndRecreated,
        recreatedAs: [id(101)]
      })
    )
  })

  it('records built-over ground, Created in another type, as lost in full, not re-created', () => {
    const area = parcel(1, 2500)

    expect(
      lostBaselineHabitats(
        {
          habitats: [
            child(1, area, 'Created', 2500, {
              type: 'Developed land; sealed surface'
            })
          ]
        },
        { habitats: [area] }
      )
    ).toEqual([
      {
        layer: 'habitats',
        featureId: area.featureId,
        ref: 'H001',
        type: 'Other neutral grassland',
        outcome: LOST_OUTCOME.lost,
        lostSizeSquareMetres: 2500,
        recreatedAs: []
      }
    ])
  })

  it('does not count a Created child’s size as retained', () => {
    const hedge = line(1, 100)

    const [lost] = lostBaselineHabitats(
      {
        hedgerows: [
          child(1, hedge, 'Created', 100, {
            type: 'Species-rich native hedgerow'
          })
        ]
      },
      { hedgerows: [hedge] }
    )

    expect(lost.lostSizeMetres).toBe(100)
  })

  it('records part of a parent lost where its children keep less than it', () => {
    const area = parcel(1, 1000)

    const [lost] = lostBaselineHabitats(
      { habitats: [child(1, area, 'Retained', 700)] },
      { habitats: [area] }
    )

    expect(lost).toEqual(
      expect.objectContaining({
        outcome: LOST_OUTCOME.lost,
        lostSizeSquareMetres: 300
      })
    )
  })

  it('records no loss for a sliver below the smallest parcel, but does above it', () => {
    const area = parcel(1, 1000)
    const lostFrom = (retained) =>
      lostBaselineHabitats(
        { habitats: [child(1, area, 'Retained', retained)] },
        { habitats: [area] }
      )

    expect(lostFrom(999.5)).toEqual([])
    expect(lostFrom(998)).toEqual([
      expect.objectContaining({ lostSizeSquareMetres: 2 })
    ])
  })

  it('records no loss for an Enhanced watercourse longer than its parent', () => {
    const ditch = line(1, 100, DITCH)

    expect(
      lostBaselineHabitats(
        { watercourses: [child(1, ditch, 'Enhanced', 130)] },
        { watercourses: [ditch] }
      )
    ).toEqual([])
  })
})

describe('nullDisallowedWatercourseAdvance', () => {
  const ditch = line(1, 100, DITCH)

  function created(proposed, sizeMetres = 100) {
    return child(1, ditch, 'Created', sizeMetres, { ...DITCH, ...proposed })
  }

  it.each([
    ['a lower condition', { condition: 'Poor', advanceYears: 10 }],
    ['a shorter length', { advanceYears: 30 }, 60],
    [
      'more encroachment and a lower condition',
      { condition: 'Poor', watercourseEncroachment: 'Major', advanceYears: 15 }
    ],
    ['another River Type', { type: 'Canals', advanceYears: 10 }]
  ])(
    'nulls 10 or more years in advance on a Created watercourse with %s',
    (_, proposed, sizeMetres) => {
      const feature = created(proposed, sizeMetres)
      const document = { watercourses: [feature] }

      expect(
        nullDisallowedWatercourseAdvance(document, { watercourses: [ditch] })
      ).toEqual([feature])
      expect(feature.proposed.advanceYears).toBeNull()
    }
  )

  it.each([
    [
      'an encroachment-only change',
      { watercourseEncroachment: 'Major', advanceYears: 30 }
    ],
    ['an advance under 10 years', { condition: 'Poor', advanceYears: 9 }],
    ['no advance', { condition: 'Poor', advanceYears: null }]
  ])('keeps the advance on %s', (_, proposed) => {
    const feature = created(proposed)

    expect(
      nullDisallowedWatercourseAdvance(
        { watercourses: [feature] },
        { watercourses: [ditch] }
      )
    ).toEqual([])
    expect(feature.proposed.advanceYears).toBe(proposed.advanceYears)
  })

  it('keeps the advance on an encroachment-only change drawn in pieces: together they are its length', () => {
    const encroached = { ...DITCH, watercourseEncroachment: 'Major' }
    const pieces = [
      child(1, ditch, 'Created', 50, { ...encroached, advanceYears: 10 }),
      child(2, ditch, 'Created', 50, { ...encroached, advanceYears: 10 })
    ]

    expect(
      nullDisallowedWatercourseAdvance(
        { watercourses: pieces },
        { watercourses: [ditch] }
      )
    ).toEqual([])
    expect(pieces.map((piece) => piece.proposed.advanceYears)).toEqual([10, 10])
  })

  it('nulls the advance on pieces shorter than their parent together', () => {
    const encroached = { ...DITCH, watercourseEncroachment: 'Major' }
    const pieces = [
      child(1, ditch, 'Created', 50, { ...encroached, advanceYears: 10 }),
      child(2, ditch, 'Created', 40, { ...encroached, advanceYears: 10 })
    ]

    expect(
      nullDisallowedWatercourseAdvance(
        { watercourses: pieces },
        { watercourses: [ditch] }
      )
    ).toEqual(pieces)
  })

  it('leaves a Created watercourse with no parent, and an Enhanced one, alone', () => {
    const unlinked = {
      ...created({ condition: 'Poor', advanceYears: 20 }),
      parentFeatureId: undefined
    }
    const enhanced = {
      ...created({ condition: 'Good', advanceYears: 20 }),
      retentionCategory: 'Enhanced'
    }

    expect(
      nullDisallowedWatercourseAdvance(
        { watercourses: [unlinked, enhanced] },
        { watercourses: [ditch] }
      )
    ).toEqual([])
  })
})

describe('applyLineageOutcomes', () => {
  it('nulls the advance the guide does not allow, with a warning, and records the lost habitats', () => {
    const ditch = line(1, 100, DITCH)
    const lost = line(2, 50, { ...DITCH, ref: 'R002' })
    const feature = child(1, ditch, 'Created', 100, {
      ...DITCH,
      condition: 'Poor',
      advanceYears: 10
    })
    const document = { watercourses: [feature] }
    const logger = { warn: vi.fn() }

    applyLineageOutcomes(document, { watercourses: [ditch, lost] }, logger)

    expect(feature.proposed.advanceYears).toBeNull()
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(
      document.lostHabitats.map((entry) => [entry.ref, entry.outcome])
    ).toEqual([
      ['L001', LOST_OUTCOME.lostAndRecreated],
      ['R002', LOST_OUTCOME.removed]
    ])
  })
})
