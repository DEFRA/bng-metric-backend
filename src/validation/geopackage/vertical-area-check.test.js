import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from './errors.js'
import {
  checkVerticalHabitatAreas,
  verticalAreaSquareMetres
} from './vertical-area-check.js'

const TABLE = 'Vertical Area Habitats Baseline'

function vertical(area, extra = {}) {
  return { properties: { Area: area, ...extra } }
}

describe('verticalAreaSquareMetres', () => {
  it.each([
    [40, 40],
    [0.5, 0.5],
    ['12', 12],
    [' 7.25 ', 7.25]
  ])('reads %j as %j square metres', (value, expected) => {
    expect(verticalAreaSquareMetres(value)).toBe(expected)
  })

  it.each([
    undefined,
    null,
    '',
    '   ',
    0,
    -5,
    '-5',
    '0x3',
    '1e3',
    '40 m²',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    true
  ])('refuses %j', (value) => {
    expect(verticalAreaSquareMetres(value)).toBeNull()
  })
})

describe('checkVerticalHabitatAreas', () => {
  it('returns null when every vertical area habitat has an area above 0', () => {
    const layers = {
      verticalHabitats: [
        vertical(40, { 'Parcel Ref': 'V001' }),
        vertical('12.5', { 'Parcel Ref': 'V002' })
      ]
    }
    expect(checkVerticalHabitatAreas(layers)).toBeNull()
  })

  it('returns null for a file with no vertical area habitats', () => {
    expect(checkVerticalHabitatAreas({ areas: [] })).toBeNull()
    expect(checkVerticalHabitatAreas(undefined)).toBeNull()
  })

  it('refuses a blank, zero, negative or non-numeric area in one error, naming each row', () => {
    const layers = {
      layerTables: { verticalHabitats: TABLE },
      verticalHabitats: [
        vertical(40, { 'Parcel Ref': 'V001' }),
        vertical(null, { 'Parcel Ref': 'V002' }),
        vertical(0, { 'Parcel Ref': 'V003' }),
        vertical(-12, { 'Parcel Ref': 'V004' }),
        vertical('lots', { fid: 9 })
      ]
    }

    const error = checkVerticalHabitatAreas(layers)

    expect(error.code).toBe(ERROR_CODES.VERTICAL_HABITAT_AREA_NOT_POSITIVE)
    expect(error.details.count).toBe(4)
    expect(error.message).toBe(
      'One or more vertical area habitats have an "Area (m²)" that is not a number above 0. Enter the face area you estimated on site, in square metres: ' +
        `${TABLE} Habitat Ref V002 (blank), ${TABLE} Habitat Ref V003 (0), ${TABLE} Habitat Ref V004 (-12), ${TABLE} fid 9 (lots)`
    )
    expect(error.details.sample[2]).toEqual({
      layer: 'verticalHabitats',
      table: TABLE,
      feature_ref: 'V004',
      fid: null,
      idx: 3,
      area: -12
    })
  })

  it('caps the sample and says how many more there are', () => {
    const layers = {
      verticalHabitats: Array.from({ length: 52 }, (_, index) =>
        vertical(-1, { 'Parcel Ref': `V${index}` })
      )
    }

    const error = checkVerticalHabitatAreas(layers)

    expect(error.details.count).toBe(52)
    expect(error.details.sample).toHaveLength(50)
    expect(error.message).toMatch(/\(and 2 more\)$/)
  })
})
