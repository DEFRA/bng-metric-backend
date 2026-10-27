import { describe, expect, it } from 'vitest'

import {
  LENGTH_TOLERANCE_METRES,
  conditionScore,
  createdInOwnTypeMetres,
  encroachmentChange,
  isLowerCondition,
  isSameHabitatType,
  isShorter,
  watercourseChange
} from './habitat-change.js'

const GRASSLAND = {
  type: 'Other neutral grassland',
  broadType: 'Grassland'
}
const HEDGE = { type: 'Native hedgerow' }
const DITCH = {
  type: 'Ditches',
  condition: 'Moderate',
  watercourseEncroachment: 'No Encroachment',
  riparianEncroachment: 'No Encroachment/No Encroachment'
}

describe('conditionScore', () => {
  it('scores an area habitat under its broad habitat, as the Metric keys it', () => {
    expect(conditionScore('areas', { ...GRASSLAND, condition: 'Good' })).toBe(3)
    expect(conditionScore('areas', { ...GRASSLAND, condition: 'Poor' })).toBe(1)
  })

  it('reads a condition with a numbered prefix', () => {
    expect(
      conditionScore('hedgerows', { ...HEDGE, condition: '2. Moderate' })
    ).toBe(2)
  })

  it.each([
    ['no condition', { ...HEDGE, condition: null }],
    ['an unknown type', { type: 'Not a hedge', condition: 'Good' }],
    [
      'a condition the Metric marks Not Possible',
      { ...HEDGE, condition: 'Fairly Good' }
    ]
  ])('is null for %s', (_, side) => {
    expect(conditionScore('hedgerows', side)).toBeNull()
  })
})

describe('isLowerCondition', () => {
  it('is true only when the child scores below its parent', () => {
    const good = { ...HEDGE, condition: 'Good' }
    const poor = { ...HEDGE, condition: 'Poor' }

    expect(isLowerCondition('hedgerows', good, poor)).toBe(true)
    expect(isLowerCondition('hedgerows', good, good)).toBe(false)
    expect(isLowerCondition('hedgerows', poor, good)).toBe(false)
  })

  it('is false when either condition cannot be scored', () => {
    expect(
      isLowerCondition(
        'hedgerows',
        { ...HEDGE, condition: 'Good' },
        { ...HEDGE, condition: null }
      )
    ).toBe(false)
  })
})

describe('isSameHabitatType', () => {
  it('compares the types trimmed and in any case', () => {
    expect(isSameHabitatType({ type: 'Ditches' }, { type: ' ditches ' })).toBe(
      true
    )
    expect(isSameHabitatType({ type: 'Ditches' }, { type: 'Canals' })).toBe(
      false
    )
    expect(isSameHabitatType({ type: null }, { type: null })).toBe(false)
  })
})

describe('encroachmentChange', () => {
  it('finds encroachment into the watercourse worse', () => {
    expect(
      encroachmentChange(DITCH, { ...DITCH, watercourseEncroachment: 'Minor' })
    ).toEqual({ worse: true, better: false })
  })

  it('reads the template’s spelling of the riparian zone, with a space after the slash', () => {
    expect(
      encroachmentChange(DITCH, {
        ...DITCH,
        riparianEncroachment: 'Moderate/ Minor'
      })
    ).toEqual({ worse: true, better: false })
  })

  it('finds one worse and the other better', () => {
    expect(
      encroachmentChange(
        { ...DITCH, watercourseEncroachment: 'Minor' },
        {
          ...DITCH,
          watercourseEncroachment: 'No Encroachment',
          riparianEncroachment: 'Major/Major'
        }
      )
    ).toEqual({ worse: true, better: true })
  })

  it('moves neither way on a value the Metric does not know', () => {
    expect(
      encroachmentChange(DITCH, { ...DITCH, watercourseEncroachment: 'Lots' })
    ).toEqual({ worse: false, better: false })
  })
})

describe('isShorter', () => {
  it('allows the tolerance either way', () => {
    expect(isShorter(100, 100 - LENGTH_TOLERANCE_METRES / 2)).toBe(false)
    expect(isShorter(100, 99)).toBe(true)
    expect(isShorter(100, 101)).toBe(false)
    expect(isShorter(Number.NaN, 1)).toBe(false)
  })
})

describe('createdInOwnTypeMetres', () => {
  it('adds up the Created children of the parent’s own type, leaving out any other', () => {
    expect(
      createdInOwnTypeMetres(DITCH, [
        { side: DITCH, lengthMetres: 50 },
        { side: { ...DITCH, condition: 'Poor' }, lengthMetres: 30 },
        { side: { ...DITCH, type: 'Canals' }, lengthMetres: 20 }
      ])
    ).toBe(80)
  })

  it('is 0 with no children of its own type', () => {
    expect(createdInOwnTypeMetres(DITCH, [])).toBe(0)
  })
})

describe('watercourseChange', () => {
  const parent = { side: DITCH, lengthMetres: 100 }

  it('finds no change in a copy of its parent', () => {
    expect(
      watercourseChange(parent, { side: DITCH, lengthMetres: 100 })
    ).toEqual({ worse: false, encroachmentOnly: false })
  })

  it('finds a lower condition worse, and not an encroachment-only change', () => {
    expect(
      watercourseChange(parent, {
        side: { ...DITCH, condition: 'Poor' },
        lengthMetres: 100
      })
    ).toEqual({ worse: true, encroachmentOnly: false })
  })

  it('finds a shorter length alone worse', () => {
    expect(
      watercourseChange(parent, { side: DITCH, lengthMetres: 60 })
    ).toEqual({ worse: true, encroachmentOnly: false })
  })

  it('finds more encroachment alone an encroachment-only change', () => {
    expect(
      watercourseChange(parent, {
        side: { ...DITCH, watercourseEncroachment: 'Major' },
        lengthMetres: 100
      })
    ).toEqual({ worse: true, encroachmentOnly: true })
  })

  it('does not find an encroachment-only change where the other encroachment is better', () => {
    expect(
      watercourseChange(
        {
          side: { ...DITCH, riparianEncroachment: 'Minor/Minor' },
          lengthMetres: 100
        },
        {
          side: {
            ...DITCH,
            watercourseEncroachment: 'Major',
            riparianEncroachment: 'No Encroachment/No Encroachment'
          },
          lengthMetres: 100
        }
      )
    ).toEqual({ worse: true, encroachmentOnly: false })
  })

  it('does not find an encroachment-only change in another River Type', () => {
    expect(
      watercourseChange(parent, {
        side: { ...DITCH, type: 'Canals', watercourseEncroachment: 'Major' },
        lengthMetres: 100
      }).encroachmentOnly
    ).toBe(false)
  })
})
