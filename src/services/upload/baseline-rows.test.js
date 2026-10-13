import { describe, it, expect } from 'vitest'

import {
  countRowsWithoutBaselineType,
  filterBaselineLayers,
  isBaselineRow
} from './baseline-rows.js'

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
    'drops a Lost row whose baseline type is the placeholder %j',
    (placeholder) => {
      const lost = area({
        'Retention Category': 'Lost',
        'Baseline Habitat Type': placeholder
      })
      const retained = area({
        'Retention Category': 'Retained',
        'Baseline Habitat Type': placeholder
      })
      expect(isBaselineRow('areas', lost, { strict: true })).toBe(false)
      expect(isBaselineRow('areas', retained, { strict: true })).toBe(true)
      expect(isBaselineRow('areas', lost)).toBe(true)
    }
  )

  it.each(['', '  ', undefined])(
    'drops a Lost row whose baseline type is blank (%j)',
    (baselineType) => {
      const lost = area({
        'Retention Category': '4. Lost',
        'Baseline Habitat Type': baselineType
      })
      const retained = area({
        'Retention Category': 'Retained',
        'Baseline Habitat Type': baselineType
      })
      expect(isBaselineRow('areas', lost, { strict: true })).toBe(false)
      expect(isBaselineRow('areas', retained, { strict: true })).toBe(true)
      expect(isBaselineRow('areas', lost)).toBe(true)
    }
  )

  it('keeps a Retained or Enhanced row whose baseline type is blank', () => {
    const retained = area({
      'Retention Category': 'Retained',
      'Baseline Habitat Type': '  '
    })
    const enhanced = area({
      'Retention Category': '2. Enhanced',
      'Baseline Habitat Type': ''
    })
    expect(isBaselineRow('areas', retained, { strict: true })).toBe(true)
    expect(isBaselineRow('areas', enhanced, { strict: true })).toBe(true)
  })

  it('keeps a baseline-file row that has no retention category', () => {
    const row = area({ 'Baseline Habitat Type': 'Modified grassland' })
    expect(isBaselineRow('areas', row, { strict: true })).toBe(true)
  })

  it('reads the baseline type column for each layer', () => {
    expect(
      isBaselineRow(
        'hedgerows',
        area({
          'Retention Category': 'Lost',
          'Baseline Hedge Type': 'N/A'
        }),
        { strict: true }
      )
    ).toBe(false)
    expect(
      isBaselineRow(
        'hedgerows',
        area({
          'Retention Category': 'Enhanced',
          'Baseline Hedge Type': 'N/A'
        }),
        { strict: true }
      )
    ).toBe(true)
    expect(
      isBaselineRow(
        'watercourses',
        area({
          'Retention Category': '4. Lost',
          'Baseline River Type': 'To be created'
        }),
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

  it('counts Retained and Enhanced rows that have no baseline type', () => {
    const layers = {
      areas: [
        area({
          'Retention Category': 'Retained',
          'Baseline Habitat Type': '  '
        }),
        area({
          'Retention Category': 'Enhanced',
          'Baseline Habitat Type': 'N/A'
        }),
        area({
          'Retention Category': 'Retained',
          'Baseline Habitat Type': 'Mixed scrub'
        })
      ],
      hedgerows: [
        area({
          'Retention Category': 'Lost',
          'Baseline Hedge Type': 'N/A'
        })
      ],
      watercourses: [
        area({
          'Retention Category': 'Created',
          'Baseline River Type': ''
        }),
        area({
          'Retention Category': 'Lost',
          'Baseline River Type': '  '
        })
      ]
    }

    expect(countRowsWithoutBaselineType(layers)).toBe(2)
  })

  it('leaves the red line and non-feature layers untouched', () => {
    const filtered = filterBaselineLayers(layers, { strict: true })
    expect(filtered.redline).toBe(layers.redline)
    expect(filtered.missingLayers).toBe(layers.missingLayers)
    expect(filtered.trees).toBeUndefined()
  })
})
