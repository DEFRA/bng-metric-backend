import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from './errors.js'
import {
  checkVerticalHabitatAreas,
  verticalAreaHectares,
  verticalAreaSquareMetres
} from './vertical-area-check.js'

const TABLE = 'Vertical Area Habitats Baseline'

function vertical(area, extra = {}) {
  return { properties: { Area: area, ...extra } }
}

describe('verticalAreaHectares', () => {
  it.each([
    [0.04, 0.04],
    [0.5, 0.5],
    ['12', 12],
    [' 0.0725 ', 0.0725]
  ])('reads %j as %j hectares', (value, expected) => {
    expect(verticalAreaHectares(value)).toBe(expected)
  })

  it.each([undefined, null, '', 0, -5, '0x3', '1e3', '0.04 ha'])(
    'refuses %j',
    (value) => {
      expect(verticalAreaHectares(value)).toBeNull()
    }
  )
})

describe('verticalAreaSquareMetres', () => {
  it.each([
    [0.04, 400],
    [0.00005, 0.5],
    ['0.0012', 12],
    [' 0.000725 ', 7.25],
    // 0.07 * 10,000 is 700.0000000000001 in floating point.
    [0.07, 700],
    [0.0151, 151]
  ])('reads %j hectares as %j square metres', (value, expected) => {
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
    '0.004 ha',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    true
  ])('refuses %j', (value) => {
    expect(verticalAreaSquareMetres(value)).toBeNull()
  })
})

describe('checkVerticalHabitatAreas', () => {
  it('reads the Area only, never Shape_Area, which is in square metres', () => {
    const error = checkVerticalHabitatAreas({
      verticalHabitats: [
        vertical(undefined, { 'Parcel Ref': 'V001', Shape_Area: 400 })
      ]
    })

    expect(error.code).toBe(ERROR_CODES.VERTICAL_HABITAT_AREA_NOT_POSITIVE)
    expect(error.details.count).toBe(1)
  })

  it('returns null when every vertical area habitat has an area above 0', () => {
    const layers = {
      verticalHabitats: [
        vertical(0.004, { 'Parcel Ref': 'V001' }),
        vertical('0.00125', { 'Parcel Ref': 'V002' })
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
        vertical(0.004, { 'Parcel Ref': 'V001' }),
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
      'One or more vertical area habitats have an "Area (ha)" that is not a number above 0. Enter the area you estimated on site, in hectares: ' +
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
