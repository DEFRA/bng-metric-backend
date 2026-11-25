import { describe, expect, test } from 'vitest'

import { metricRowsFromProject } from './project-rows.js'

const LOW = 'Area/compensation not in local strategy/ no local strategy'
const HIGH = 'Formally identified in local strategy'
const TEMPLATE = { name: 'bng-service', version: '1.0' }

const area = (overrides) => ({
  broadType: 'Grassland',
  type: 'Modified grassland',
  condition: 'Poor',
  strategicSignificance: 'Low',
  sizeSquareMetres: 20_000,
  ...overrides
})

const hedgerow = (overrides) => ({
  type: 'Native hedgerow',
  condition: 'Poor',
  strategicSignificance: 'Low',
  sizeMetres: 400,
  ...overrides
})

const watercourse = (overrides) => ({
  type: 'Ditches',
  condition: 'Moderate',
  strategicSignificance: 'Low',
  watercourseEncroachment: 'No Encroachment',
  riparianEncroachment: 'No Encroachment/No Encroachment',
  sizeMetres: 300,
  ...overrides
})

function post(retentionCategory, overrides = {}, proposed = {}) {
  return {
    retentionCategory,
    ...overrides,
    proposed: {
      strategicSignificance: LOW,
      strategicSignificanceCategory: 'Low',
      advanceYears: null,
      delayYears: null,
      ...proposed
    }
  }
}

describe('metricRowsFromProject — a legacy upload, linked by ref', () => {
  const rows = metricRowsFromProject({
    baseline: {
      habitats: [
        area({ ref: 'H1', irreplaceable: true }),
        area({ ref: 'H2', sizeSquareMetres: 5000 }),
        area({ ref: 'H3', sizeSquareMetres: 8000 })
      ],
      hedgerows: [hedgerow({ ref: 'HG1' })],
      watercourses: [watercourse({ ref: 'R1' })]
    },
    postIntervention: {
      habitats: [
        post('Retained', { ref: 'H1', sizeSquareMetres: 20_000 }),
        post(
          'Enhanced',
          { ref: 'H2', sizeSquareMetres: 5000 },
          {
            broadType: 'Grassland',
            type: 'Other neutral grassland',
            condition: 'Moderate',
            strategicSignificanceCategory: 'High',
            advanceYears: 2
          }
        ),
        // A legacy Lost area habitat, stored as Created under its ref.
        post(
          'Created',
          { ref: 'H3', sizeSquareMetres: 8000 },
          { broadType: 'Urban', type: 'Vegetated garden', condition: 'Poor' }
        ),
        post(
          'Created',
          { ref: 'H4', sizeSquareMetres: 1000 },
          {
            broadType: 'Woodland and forest',
            type: 'Other woodland; broadleaved',
            condition: 'Good',
            delayYears: 3
          }
        )
      ],
      // HG1 has no post-intervention row: it is lost.
      hedgerows: [],
      watercourses: [
        post(
          'Enhanced',
          { ref: 'R1', sizeMetres: 300 },
          {
            type: 'Ditches',
            condition: 'Good',
            watercourseEncroachment: 'Minor',
            riparianEncroachment: 'Minor/No Encroachment'
          }
        )
      ]
    }
  })

  test('writes each baseline habitat at Low strategic significance, in hectares, with its own reference', () => {
    expect(rows.habitatBaseline).toEqual([
      {
        reference: 'H1',
        broadHabitat: 'Grassland',
        habitatType: 'Modified grassland',
        irreplaceable: 'Yes',
        size: 2,
        condition: 'Poor',
        strategicSignificance: LOW,
        retained: 2
      },
      {
        reference: 'H2',
        broadHabitat: 'Grassland',
        habitatType: 'Modified grassland',
        irreplaceable: 'No',
        size: 0.5,
        condition: 'Poor',
        strategicSignificance: LOW,
        enhanced: 0.5
      },
      {
        reference: 'H3',
        broadHabitat: 'Grassland',
        habitatType: 'Modified grassland',
        irreplaceable: 'No',
        size: 0.8,
        condition: 'Poor',
        strategicSignificance: LOW
      }
    ])
  })

  test('pairs each enhanced baseline habitat with its enhancement row', () => {
    expect(rows.habitatEnhancement).toEqual([
      {
        reference: 'H2',
        broadHabitat: 'Grassland',
        habitatType: 'Other neutral grassland',
        size: 0.5,
        condition: 'Moderate',
        strategicSignificance: HIGH,
        advanceYears: 2,
        delayYears: 0
      }
    ])
  })

  test('writes every Created habitat as a creation, a lost one’s replacement included', () => {
    expect(
      rows.habitatCreation.map((r) => [r.reference, r.habitatType])
    ).toEqual([
      ['H3', 'Vegetated garden'],
      ['H4', 'Other woodland; broadleaved']
    ])
    expect(rows.habitatCreation[1]).toMatchObject({
      size: 0.1,
      advanceYears: 0,
      delayYears: 3
    })
  })

  test('writes a hedgerow nothing carries forward as lost, in kilometres', () => {
    expect(rows.hedgerowBaseline).toEqual([
      {
        reference: 'HG1',
        habitatType: 'Native hedgerow',
        size: 0.4,
        condition: 'Poor',
        strategicSignificance: LOW
      }
    ])
    expect(rows.hedgerowCreation).toEqual([])
    expect(rows.hedgerowEnhancement).toEqual([])
  })

  test('writes watercourse encroachments in the metric’s own spelling', () => {
    expect(rows.watercourseBaseline[0]).toMatchObject({
      riparianEncroachment: 'No Encroachment/ No Encroachment',
      watercourseEncroachment: 'No Encroachment',
      enhanced: 0.3
    })
    expect(rows.watercourseEnhancement[0]).toMatchObject({
      riparianEncroachment: 'Minor/ No Encroachment',
      watercourseEncroachment: 'Minor',
      condition: 'Good'
    })
  })
})

describe('metricRowsFromProject — a BNG Service template upload, linked by parent', () => {
  const rows = metricRowsFromProject({
    baseline: {
      habitats: [area({ featureId: 'a1', ref: 'H1' })],
      trees: [
        {
          featureId: 't1',
          ref: 'T1',
          type: 'Urban tree',
          broadType: 'Individual trees',
          condition: 'Moderate',
          strategicSignificance: 'Low',
          sizeSquareMetres: 41
        }
      ],
      verticalHabitats: [
        area({
          featureId: 'v1',
          ref: 'V1',
          broadType: 'Urban',
          type: 'Ground based green wall',
          sizeSquareMetres: 250
        })
      ],
      hedgerows: [hedgerow({ featureId: 'g1', ref: 'HG1' })],
      watercourses: [watercourse({ featureId: 'w1', ref: 'R1' })]
    },
    postIntervention: {
      template: TEMPLATE,
      habitats: [
        // A habitat that gets worse in part: the rest of it is retained.
        post('Retained', {
          ref: 'H1',
          parentFeatureId: 'a1',
          sizeSquareMetres: 12_000
        }),
        post(
          'Created',
          { ref: 'H1b', parentFeatureId: 'a1', sizeSquareMetres: 8000 },
          {
            broadType: 'Grassland',
            type: 'Modified grassland',
            condition: 'Poor',
            advanceYears: 30,
            advanceYearsIs30Plus: true
          }
        )
      ],
      trees: [
        post('Retained', {
          ref: 'T1',
          parentFeatureId: 't1',
          sizeSquareMetres: 41
        })
      ],
      verticalHabitats: [
        post(
          'Enhanced',
          { ref: 'V1', parentFeatureId: 'v1', sizeSquareMetres: 250 },
          {
            broadType: 'Urban',
            type: 'Ground based green wall',
            condition: 'Moderate'
          }
        )
      ],
      hedgerows: [
        post('Retained', {
          ref: 'HG1',
          parentFeatureId: 'g1',
          sizeMetres: 250
        })
      ],
      watercourses: [
        post(
          'Enhanced',
          { ref: 'R1', parentFeatureId: 'w1', sizeMetres: 450 },
          { type: 'Ditches', condition: 'Good' }
        )
      ]
    }
  })

  test('places a habitat kept in part by its parts’ sizes', () => {
    expect(rows.habitatBaseline[0]).toMatchObject({
      reference: 'H1',
      size: 2,
      retained: 1.2
    })
    expect(rows.habitatBaseline[0]).not.toHaveProperty('enhanced')
    expect(rows.habitatCreation).toEqual([
      expect.objectContaining({
        reference: 'H1b',
        size: 0.8,
        advanceYears: '30+'
      })
    ])
  })

  test('writes trees and vertical area habitats on the area habitat sheets', () => {
    expect(rows.habitatBaseline.map((r) => r.reference)).toEqual([
      'H1',
      'V1',
      'T1'
    ])
    expect(rows.habitatBaseline[2]).toMatchObject({
      broadHabitat: 'Individual trees',
      habitatType: 'Urban tree',
      size: 0.0041,
      retained: 0.0041
    })
    expect(rows.habitatBaseline[1]).toMatchObject({
      broadHabitat: 'Urban',
      size: 0.025,
      enhanced: 0.025
    })
    expect(rows.habitatEnhancement).toEqual([
      expect.objectContaining({ reference: 'V1', condition: 'Moderate' })
    ])
  })

  test('places a template hedgerow by its parts, so a shorter one loses the rest', () => {
    expect(rows.hedgerowBaseline[0]).toMatchObject({
      size: 0.4,
      retained: 0.25
    })
  })

  test('enhances a template watercourse by its length as drawn', () => {
    expect(rows.watercourseBaseline[0]).toMatchObject({
      size: 0.3,
      enhanced: 0.45
    })
    expect(rows.watercourseEnhancement).toHaveLength(1)
  })
})

describe('metricRowsFromProject — a project with no post-intervention', () => {
  test('writes the baseline alone, with nothing retained, created or enhanced (BMD-1141 AC12)', () => {
    const rows = metricRowsFromProject({
      baseline: {
        habitats: [area({ ref: 'H1' })],
        hedgerows: [hedgerow({ ref: 'HG1' })]
      }
    })

    expect(rows.habitatBaseline).toHaveLength(1)
    expect(rows.hedgerowBaseline).toHaveLength(1)
    for (const row of [...rows.habitatBaseline, ...rows.hedgerowBaseline]) {
      expect(row).not.toHaveProperty('retained')
      expect(row).not.toHaveProperty('enhanced')
    }
    for (const key of [
      'habitatCreation',
      'habitatEnhancement',
      'hedgerowCreation',
      'hedgerowEnhancement',
      'watercourseBaseline',
      'watercourseCreation',
      'watercourseEnhancement'
    ]) {
      expect(rows[key], key).toEqual([])
    }
  })
})

describe('metricRowsFromProject — an incomplete feature', () => {
  test('writes what it has and leaves the rest blank', () => {
    const rows = metricRowsFromProject({
      baseline: { habitats: [] },
      postIntervention: {
        habitats: [
          post(
            'Created',
            { ref: 'H9', sizeSquareMetres: null },
            { strategicSignificance: null, strategicSignificanceCategory: null }
          )
        ]
      }
    })

    expect(rows.habitatCreation).toEqual([
      {
        reference: 'H9',
        broadHabitat: null,
        habitatType: null,
        size: null,
        condition: null,
        strategicSignificance: null,
        advanceYears: 0,
        delayYears: 0
      }
    ])
  })

  // bng-library's writer pairs enhancement rows with the baseline rows whose
  // `enhanced` is above 0, and refuses a workbook whose counts differ.
  const enhancedCount = (baselineRows) =>
    baselineRows.filter((row) => row.enhanced > 0).length

  test.each([
    ['with no size', null],
    ['of no size', 0]
  ])(
    'gives a legacy Enhanced habitat %s no enhancement row, so the rows still pair',
    (_label, sizeSquareMetres) => {
      const rows = metricRowsFromProject({
        baseline: { habitats: [area({ ref: 'H1', sizeSquareMetres })] },
        postIntervention: {
          habitats: [post('Enhanced', { ref: 'H1', sizeSquareMetres })]
        }
      })

      expect(rows.habitatEnhancement).toEqual([])
      expect(enhancedCount(rows.habitatBaseline)).toBe(0)
    }
  )

  test('gives a template Enhanced hedgerow with no length no enhancement row, so the rows still pair', () => {
    const rows = metricRowsFromProject({
      baseline: {
        hedgerows: [
          hedgerow({ featureId: 'g1', ref: 'HG1' }),
          hedgerow({ featureId: 'g2', ref: 'HG2' })
        ]
      },
      postIntervention: {
        template: TEMPLATE,
        hedgerows: [
          post('Enhanced', {
            ref: 'HG1',
            parentFeatureId: 'g1',
            sizeMetres: null
          }),
          post('Enhanced', {
            ref: 'HG2',
            parentFeatureId: 'g2',
            sizeMetres: 400
          })
        ]
      }
    })

    expect(rows.hedgerowEnhancement).toHaveLength(1)
    expect(rows.hedgerowEnhancement).toHaveLength(
      enhancedCount(rows.hedgerowBaseline)
    )
  })
})
