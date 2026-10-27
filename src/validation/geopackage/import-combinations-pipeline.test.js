import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  extractAndValidateDocument,
  saveHandlersForConfig
} from '../../services/upload/save-upload-for-project.js'
import { runDataQualityChecks } from './index.js'
import { PROPOSED_PROP_KEYS, TREE_ADVANCE_DELAY_KEYS } from './properties.js'

const LAYERS = [
  ['areas', 'habitats'],
  ['hedgerows', 'hedgerows'],
  ['watercourses', 'watercourses'],
  ['trees', 'trees']
]

function row(retention = 'Created', overrides = {}) {
  return {
    featureId: randomUUID(),
    nativeGeometry: { type: 'Polygon', coordinates: [] },
    properties: {
      'Parcel Ref': 'P1',
      'Tree Ref': 'T1',
      'Retention Category': retention,
      'Baseline Broad Habitat Type': 'Grassland',
      'Baseline Habitat Type': 'Modified grassland',
      'Baseline Hedge Type': 'Native hedgerow',
      'Baseline River Type': 'Ditches',
      'Baseline Tree Size': 'Small',
      'Baseline Rural or Urban Tree': 'Urban',
      'Baseline Condition': 'Moderate',
      'Baseline Encroachment into Watercourse': 'No Encroachment',
      'Baseline Encroachment into riparian zone':
        'No Encroachment/No Encroachment',
      'Proposed Broad Habitat Type': 'Grassland',
      'Proposed Habitat Type': 'Modified grassland',
      'Proposed Hedge Type': 'Native hedgerow',
      'Proposed River Type': 'Ditches',
      'Proposed Tree Size': 'Small',
      'Proposed Rural or Urban Tree': 'Urban',
      'Proposed Condition': 'Good',
      'Proposed Strategic Significance': 'Low',
      'Proposed Encroachment into Watercourse': 'No Encroachment',
      'Proposed Encroachment into riparian zone':
        'No Encroachment/No Encroachment',
      Count: 1,
      ...timingColumns('areas', '0', '0'),
      ...timingColumns('trees', '0', '0'),
      ...overrides
    }
  }
}

function importRows(rawLayer, rows, documentKey = 'postIntervention') {
  const config = { projectDocumentKey: documentKey }
  const layers = {
    redline: [],
    areas: [],
    hedgerows: [],
    watercourses: [],
    trees: [],
    [rawLayer]: rows
  }
  const result = extractAndValidateDocument({
    handlers: saveHandlersForConfig(config),
    layersWithIds: layers,
    context: {
      uploadId: randomUUID(),
      filename: 'combinations.gpkg',
      fileSize: 1
    },
    config,
    storedProject: {
      baseline: {
        hedgerows: [{ ref: 'P1', sizeMetres: 100 }],
        watercourses: [{ ref: 'P1', sizeMetres: 100 }]
      }
    },
    logger: { info: vi.fn(), warn: vi.fn() },
    habitatSizes: {
      areaHabitats: {
        totalSquareMetres: rows.length * 10000,
        individualSquareMetres: rows.map(({ featureId }) => ({
          featureId,
          sizeSquareMetres: 10000
        }))
      },
      hedgerows: {
        totalMetres: rows.length * 100,
        individualMetres: rows.map(({ featureId }) => ({
          featureId,
          sizeMetres: 100
        }))
      },
      watercourses: {
        totalMetres: rows.length * 100,
        individualMetres: rows.map(({ featureId }) => ({
          featureId,
          sizeMetres: 100
        }))
      }
    }
  })
  expect(result.schemaError).toBeUndefined()
  return result.document
}

function timingColumns(rawLayer, advance, delay) {
  const keys =
    rawLayer === 'trees' ? TREE_ADVANCE_DELAY_KEYS : PROPOSED_PROP_KEYS
  return { [keys.advanceYears[0]]: advance, [keys.delayYears[0]]: delay }
}

describe('BMD-1060 full extraction, combination validation and enrichment', () => {
  it('AC1 clears actual baseline timing fields rather than only proposed field names', () => {
    const feature = row('Lost', {
      'Baseline Broad Habitat Type': 'Urban',
      'Habitat created in advance/years': '2',
      'Delay in starting habitat creation/years': '3'
    })
    const document = importRows('areas', [feature], 'baseline')
    expect(document.habitats[0]).toMatchObject({
      broadType: 'Urban',
      type: null,
      condition: null,
      habitatCreatedInAdvanceYears: null,
      delayInStartingHabitatCreationYears: null
    })
    expect(document.habitats[0].properties).toEqual(feature.properties)
  })

  it.each(['Created', 'Enhanced', 'Retained', 'Lost'])(
    'AC1 saves the full proposed cascade for %s',
    (retention) => {
      const feature = row(retention, {
        'Proposed Broad Habitat Type': 'Urban',
        ...timingColumns('areas', '2', '0')
      })
      const document = importRows('areas', [feature])
      const habitat = document.habitats[0]
      expect(habitat.proposed).toMatchObject({
        broadType: 'Urban',
        type: null,
        condition: null,
        advanceYears: null,
        delayYears: null,
        strategicSignificance: ['Created', 'Enhanced'].includes(retention)
          ? null
          : 'Low'
      })
      expect(habitat.baseline.type).toBe('Modified grassland')
      expect(habitat.status).toBe('Incomplete')
      expect(habitat.properties).toEqual(feature.properties)
    }
  )

  it.each([
    [
      'areas',
      'habitats',
      {
        'Proposed Broad Habitat Type': 'Urban',
        'Proposed Habitat Type': 'Developed land; sealed surface'
      },
      'Good'
    ],
    ['hedgerows', 'hedgerows', {}, 'Fairly Good'],
    [
      'watercourses',
      'watercourses',
      { 'Proposed River Type': 'Culvert' },
      'Moderate'
    ],
    ['trees', 'trees', {}, 'N/A - Other']
  ])(
    'AC2 nulls only the incompatible condition after enrichment: %s',
    (rawLayer, layer, identity, condition) => {
      const control = importRows(rawLayer, [row('Created')])[layer][0]
      expect(control.status).toBe('Complete')
      expect(control.units).toBeGreaterThan(0)
      const feature = row('Created', {
        ...identity,
        'Proposed Condition': condition,
        ...timingColumns(rawLayer, '2', '0')
      })
      const habitat = importRows(rawLayer, [feature])[layer][0]
      expect(habitat.proposed.condition).toBeNull()
      expect(habitat.proposed.type).not.toBeNull()
      expect(habitat.proposed.strategicSignificance).toBe('Low')
      expect(habitat.proposed.advanceYears).toBe(2)
      expect(habitat.proposed.delayYears).toBe(0)
      expect(habitat.status).toBe('Incomplete')
      expect(habitat.properties).toEqual(feature.properties)
    }
  )

  const timingCases = LAYERS.flatMap(([rawLayer, layer]) =>
    ['Created', 'Enhanced', 'Retained'].flatMap((retention) =>
      [
        ['2', '3', null, null],
        ['0.5', '0.25', null, null],
        [null, null, null, null],
        [null, '0', null, 0],
        ['0', null, 0, null],
        [' ', '\t', null, null],
        ['2', '0', 2, 0],
        ['0', '3', 0, 3],
        ['0', '0', 0, 0]
      ].map(([advance, delay, expectedAdvance, expectedDelay]) => [
        rawLayer,
        layer,
        retention,
        advance,
        delay,
        expectedAdvance,
        expectedDelay
      ])
    )
  )
  it.each(timingCases)(
    'AC3-AC5 keep saved timing null after enrichment: %s/%s/%s (%s,%s)',
    (
      rawLayer,
      layer,
      retention,
      advance,
      delay,
      expectedAdvance,
      expectedDelay
    ) => {
      const feature = row(retention, timingColumns(rawLayer, advance, delay))
      expect(
        runDataQualityChecks({ [rawLayer]: [feature] }, 'postIntervention')
      ).toEqual([])
      const habitat = importRows(rawLayer, [feature])[layer][0]
      expect(habitat.proposed).toMatchObject({
        advanceYears: retention === 'Retained' ? null : expectedAdvance,
        delayYears: retention === 'Retained' ? null : expectedDelay
      })
      expect(habitat.proposed.type).not.toBeNull()
      expect(habitat.proposed.condition).toBe('Good')
      if (
        retention === 'Retained' ||
        (expectedAdvance !== null && expectedDelay !== null)
      ) {
        expect(habitat.status).toBe('Complete')
        expect(habitat.units).toBeGreaterThan(0)
      } else {
        expect(habitat).toMatchObject({ status: 'Incomplete', units: null })
      }
      expect(habitat.properties).toEqual(feature.properties)
    }
  )

  it.each([
    ['2', '0', 2, 0],
    ['0', '3', 0, 3],
    ['0', '0', 0, 0],
    [null, null, null, null],
    ['2', '3', null, null]
  ])(
    'AC5 treats Lost areas as Created for timing (%s, %s)',
    (advance, delay, expectedAdvance, expectedDelay) => {
      const lost = row('4. Lost', timingColumns('areas', advance, delay))
      const created = row('1. Created', timingColumns('areas', advance, delay))
      const [lostHabitat, createdHabitat] = importRows('areas', [
        lost,
        created
      ]).habitats
      expect(lostHabitat.retentionCategory).toBe('Created')
      expect(lostHabitat.proposed).toMatchObject({
        advanceYears: expectedAdvance,
        delayYears: expectedDelay
      })
      expect(createdHabitat.proposed).toMatchObject({
        advanceYears: expectedAdvance,
        delayYears: expectedDelay
      })
      expect(lostHabitat.status).toBe(createdHabitat.status)
      expect(lostHabitat.units).toEqual(createdHabitat.units)
      expect(lostHabitat.properties).toEqual(lost.properties)
    }
  )

  it.each(LAYERS.slice(1))(
    'preserves existing exclusion of Lost %s from PI while keeping baseline rows',
    (rawLayer, layer) => {
      const feature = row('Lost', timingColumns(rawLayer, '2', '3'))
      expect(importRows(rawLayer, [feature])[layer]).toHaveLength(0)
      expect(importRows(rawLayer, [feature], 'baseline')[layer]).toHaveLength(1)
    }
  )
})
