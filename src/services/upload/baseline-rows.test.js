import { describe, it, expect } from 'vitest'

import { filterBaselineLayers, isBaselineRow } from './baseline-rows.js'

function area(props) {
  return { properties: props }
}

describe('isBaselineRow', () => {
  it.each(['Retained', 'Enhanced', 'Lost', '2. Retained', '4. Lost'])(
    'keeps a %s row with a baseline habitat',
    (retention) => {
      const row = area({
        'Retention Category': retention,
        'Baseline Habitat Type': 'Modified grassland'
      })
      expect(isBaselineRow('areas', row, { strict: true })).toBe(true)
    }
  )

  it.each(['Created', '1. Created'])('drops a %s row', (retention) => {
    const row = area({
      'Retention Category': retention,
      'Baseline Habitat Type': 'Modified grassland'
    })
    expect(isBaselineRow('areas', row)).toBe(false)
  })

  it.each(['Null', 'N/A', '(no selection)', 'To be created', ' n/a '])(
    'drops a placeholder baseline type %j only in strict mode',
    (placeholder) => {
      const row = area({
        'Retention Category': 'Retained',
        'Baseline Habitat Type': placeholder
      })
      expect(isBaselineRow('areas', row, { strict: true })).toBe(false)
      expect(isBaselineRow('areas', row)).toBe(true)
    }
  )

  it('drops a blank baseline type only in strict mode', () => {
    const row = area({ 'Baseline Habitat Type': '  ' })
    expect(isBaselineRow('areas', row, { strict: true })).toBe(false)
    expect(isBaselineRow('areas', row)).toBe(true)
  })

  it('keeps a baseline-file row that has no retention category', () => {
    const row = area({ 'Baseline Habitat Type': 'Modified grassland' })
    expect(isBaselineRow('areas', row, { strict: true })).toBe(true)
  })

  it('reads the baseline type column for each layer', () => {
    expect(
      isBaselineRow('hedgerows', area({ 'Baseline Hedge Type': 'N/A' }), {
        strict: true
      })
    ).toBe(false)
    expect(
      isBaselineRow('hedgerows', area({ 'Baseline Hedge Type': 'N/A' }))
    ).toBe(true)
    expect(
      isBaselineRow(
        'watercourses',
        area({ 'Baseline River Type': 'To be created' }),
        { strict: true }
      )
    ).toBe(false)
    expect(
      isBaselineRow('trees', area({ 'Baseline Tree Size': 'Medium' }), {
        strict: true
      })
    ).toBe(true)
  })
})

describe('filterBaselineLayers', () => {
  const layers = {
    redline: [{ properties: {} }],
    areas: [
      area({ 'Parcel Ref': 'H1', 'Baseline Habitat Type': 'Mixed scrub' }),
      area({
        'Parcel Ref': 'H2',
        'Retention Category': 'Created',
        'Baseline Habitat Type': 'N/A'
      }),
      area({
        'Parcel Ref': 'H1',
        'Retention Category': 'Lost',
        'Baseline Habitat Type': 'Modified grassland'
      })
    ],
    hedgerows: [
      area({ 'Retention Category': 'Lost', 'Baseline Hedge Type': 'Native' }),
      area({ 'Retention Category': 'Created', 'Baseline Hedge Type': '' })
    ],
    watercourses: [],
    missingLayers: ['trees']
  }

  it('keeps one entry per baseline row, duplicate refs included', () => {
    const filtered = filterBaselineLayers(layers, { strict: true })
    expect(filtered.areas.map((f) => f.properties['Parcel Ref'])).toEqual([
      'H1',
      'H1'
    ])
    expect(filtered.hedgerows).toHaveLength(1)
  })

  it('leaves the red line and non-feature layers untouched', () => {
    const filtered = filterBaselineLayers(layers, { strict: true })
    expect(filtered.redline).toBe(layers.redline)
    expect(filtered.missingLayers).toBe(layers.missingLayers)
    expect(filtered.trees).toBeUndefined()
  })
})
