import { describe, expect, it } from 'vitest'
import {
  normaliseImportedAttributes,
  normaliseImportedDocument
} from './normalise-imported-attributes.js'
import { extractHabitatData } from './baseline/extract-habitat-data.js'
import { extractPostIntervention } from './post-intervention/extract-post-intervention.js'

const area = () => ({
  broadType: 'Grassland',
  type: 'Modified grassland',
  condition: 'Good',
  strategicSignificance: 'Keep me',
  advanceYears: 2,
  delayYears: 3
})
const watercourse = () => ({
  type: 'Ditches',
  condition: 'Good',
  watercourseEncroachment: 'No Encroachment',
  riparianEncroachment: 'No Encroachment/No Encroachment'
})

describe('BMD-1059 imported attributes', () => {
  const examples = {
    habitats: area,
    hedgerows: () => ({ type: 'Native hedgerow', condition: 'Good' }),
    watercourses: watercourse,
    trees: () => ({
      broadType: 'Individual trees',
      type: 'Urban tree',
      condition: 'Good'
    })
  }
  const cases = Object.entries(examples).flatMap(([layer, makeFeature]) =>
    Object.keys(makeFeature())
      .filter(
        (field) =>
          !['strategicSignificance', 'advanceYears', 'delayYears'].includes(
            field
          )
      )
      .flatMap((field) =>
        [false, true].flatMap((proposed) =>
          [
            null,
            '',
            '\t\n\u00a0',
            'UNKNOWN',
            '__proto__',
            'toString',
            42,
            false
          ].map((value) => ({ layer, makeFeature, field, proposed, value }))
        )
      )
  )
  it.each(cases)(
    'AC1/AC2 $layer.$field proposed=$proposed value=$value',
    ({ layer, makeFeature, field, proposed, value }) => {
      const attributes = { ...makeFeature(), [field]: value }
      normaliseImportedAttributes(attributes, layer, proposed)
      expect(attributes[field]).toBeNull()
    }
  )

  it.each(Object.entries(examples))(
    'keeps valid %s attributes',
    (layer, makeFeature) => {
      const feature = makeFeature()
      const document = { [layer]: [{ ...feature }] }
      normaliseImportedDocument(document)
      expect(document[layer][0]).toEqual(feature)
    }
  )

  it('normalises aliased attributes on both sides without changing source properties', () => {
    const properties = {
      baseline_condition: ' \t ',
      'proposed condition': '99. Unknown',
      'Baseline Broad Habitat Type': 'Grassland',
      'Baseline Habitat Type': 'Modified grassland',
      'Proposed Broad Habitat Type': 'Grassland',
      'Proposed Habitat Type': 'Modified grassland'
    }
    const { document } = extractPostIntervention({ areas: [{ properties }] })
    normaliseImportedDocument(document, true)
    expect(document.habitats[0].baseline.condition).toBeNull()
    expect(document.habitats[0].proposed.condition).toBeNull()
    expect(document.habitats[0].properties).toEqual(properties)
  })

  it('does not clear siblings or timing when only condition is missing', () => {
    const attributes = { ...area(), condition: null }
    normaliseImportedAttributes(attributes, 'habitats', true)
    expect(attributes).toEqual({ ...area(), condition: null })
  })

  it('preserves recognised high-distinctiveness types for the existing scope gate', () => {
    const attributes = { ...watercourse(), type: 'Priority habitat' }
    normaliseImportedAttributes(attributes, 'watercourses')
    expect(attributes.type).toBe('Priority habitat')
  })

  it('handles empty documents and absent nested sides', () => {
    expect(normaliseImportedDocument({})).toEqual({})
    expect(normaliseImportedDocument({ habitats: [{}] }, true)).toEqual({
      habitats: [{ status: 'Incomplete' }]
    })
  })

  it.each([null, undefined, '', ' \t\r\n', 'not in the reference', 42, {}])(
    'nulls unsupported or absent values (%j)',
    (value) => {
      for (const field of ['broadType', 'type', 'condition']) {
        const attributes = { ...area(), [field]: value }
        normaliseImportedAttributes(attributes, 'habitats')
        expect(attributes[field]).toBeNull()
      }
      for (const field of [
        'type',
        'condition',
        'watercourseEncroachment',
        'riparianEncroachment'
      ]) {
        const attributes = { ...watercourse(), [field]: value }
        normaliseImportedAttributes(attributes, 'watercourses')
        expect(attributes[field]).toBeNull()
      }
    }
  )

  it.each(['broadType', 'type'])(
    'clears dependencies when area %s is null',
    (field) => {
      const baseline = { ...area(), [field]: null }
      normaliseImportedAttributes(baseline, 'habitats')
      expect(baseline.type).toBeNull()
      expect(baseline.condition).toBeNull()
      expect(baseline.strategicSignificance).toBe('Keep me')
      const proposed = { ...area(), [field]: null }
      normaliseImportedAttributes(proposed, 'habitats', true)
      expect(proposed).toMatchObject({
        type: null,
        condition: null,
        strategicSignificance: null,
        advanceYears: null,
        delayYears: null
      })
    }
  )

  it('does not require a broad habitat on linear features', () => {
    const attributes = watercourse()
    normaliseImportedAttributes(attributes, 'watercourses')
    expect(attributes).toEqual(watercourse())
    Object.assign(attributes, {
      strategicSignificance: 'Keep me',
      advanceYears: 2,
      delayYears: 3
    })
    attributes.type = null
    normaliseImportedAttributes(attributes, 'watercourses', true)
    expect(attributes).toMatchObject({
      condition: null,
      watercourseEncroachment: null,
      riparianEncroachment: null,
      advanceYears: null,
      delayYears: null,
      strategicSignificance: null
    })
  })

  it('validates reference membership without validating combinations or strategic significance', () => {
    const attributes = {
      ...area(),
      broadType: 'Cropland',
      condition: 'N/A - Other'
    }
    const original = { ...attributes }
    normaliseImportedAttributes(attributes, 'habitats', true)
    expect(attributes).toEqual(original)
  })

  it('preserves numbered condition and encroachment label support', () => {
    const attributes = {
      ...watercourse(),
      condition: '3. Good',
      watercourseEncroachment: '2. Minor',
      riparianEncroachment: '3. Minor/ No Encroachment'
    }
    normaliseImportedAttributes(attributes, 'watercourses')
    expect(attributes).toMatchObject({
      condition: 'Good',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: 'Minor/No Encroachment'
    })
  })

  it('normalises invalid attributes while preserving the original properties', () => {
    const properties = {
      'Baseline Broad Habitat Type': 'bad',
      'Baseline Habitat Type': 'Modified grassland',
      'Baseline Condition': '  '
    }
    const { document } = extractHabitatData({ areas: [{ properties }] })
    normaliseImportedDocument(document)
    expect(document.habitats[0]).toMatchObject({
      broadType: null,
      type: null,
      condition: null,
      properties
    })
  })

  const retainedExamples = [
    [
      'areas',
      'habitats',
      {
        'Baseline Broad Habitat Type': 'Grassland',
        'Baseline Habitat Type': 'Modified grassland'
      },
      { broadType: 'Grassland', type: 'Modified grassland', condition: 'Good' }
    ],
    [
      'hedgerows',
      'hedgerows',
      { 'Baseline Hedge Type': 'Native hedgerow' },
      { type: 'Native hedgerow', condition: 'Good' }
    ],
    [
      'watercourses',
      'watercourses',
      {
        'Baseline River Type': 'Ditches',
        'Baseline Encroachment into Watercourse': 'No Encroachment',
        'Baseline Encroachment into riparian zone':
          'No Encroachment/No Encroachment'
      },
      watercourse()
    ],
    [
      'trees',
      'trees',
      {
        'Baseline Rural or Urban Tree': 'Urban',
        'Baseline Tree Size': 'Small'
      },
      { broadType: 'Individual trees', type: 'Urban tree', condition: 'Good' }
    ]
  ]

  it.each(retainedExamples)(
    'copies empty retained %s proposed attributes before validation',
    (sourceLayer, layer, identity, expected) => {
      const properties = {
        ...identity,
        'Baseline Condition': 'Good',
        'Retention Category': 'Retained'
      }
      const { document } = extractPostIntervention({
        [sourceLayer]: [{ properties }]
      })
      normaliseImportedDocument(document, true)
      expect(document[layer][0].proposed).toMatchObject(expected)
      expect(document[layer][0].status).toBe('Complete')
      expect(document[layer][0].properties).toEqual(properties)
    }
  )

  it.each(['Created', 'Enhanced'])(
    'preserves empty proposed attributes for %s features',
    (retentionCategory) => {
      const { document } = extractPostIntervention({
        areas: [
          {
            properties: {
              'Baseline Broad Habitat Type': 'Grassland',
              'Baseline Habitat Type': 'Modified grassland',
              'Baseline Condition': 'Good',
              'Retention Category': retentionCategory
            }
          }
        ]
      })
      normaliseImportedDocument(document, true)
      expect(document.habitats[0].proposed).toMatchObject({
        broadType: null,
        type: null,
        condition: null
      })
      expect(document.habitats[0].status).toBe('Incomplete')
    }
  )

  it.each(
    retainedExamples.flatMap((example) =>
      [null, '', ' \t ', undefined].map((proposedCondition) => [
        ...example,
        proposedCondition
      ])
    )
  )(
    'validates invalid baseline values copied to retained %s',
    (sourceLayer, layer, identity, _expected, proposedCondition) => {
      const { document } = extractPostIntervention({
        [sourceLayer]: [
          {
            properties: {
              ...identity,
              'Baseline Condition': 'unknown condition',
              'Proposed Condition': proposedCondition,
              'Retention Category': 'Retained'
            }
          }
        ]
      })
      normaliseImportedDocument(document, true)
      expect(document[layer][0].baseline.condition).toBeNull()
      expect(document[layer][0].proposed.condition).toBeNull()
      expect(document[layer][0].status).toBe('Incomplete')
    }
  )

  it.each(Object.entries(examples))(
    'marks nonempty invalid %s conditions Incomplete on either upload type',
    (layer, makeFeature) => {
      for (const proposed of [false, true]) {
        const attributes = { ...makeFeature(), condition: 'unknown condition' }
        const feature = proposed
          ? { baseline: makeFeature(), proposed: attributes }
          : attributes
        feature.status = 'Complete'
        normaliseImportedDocument({ [layer]: [feature] }, proposed)
        expect(feature.status).toBe('Incomplete')
        expect(attributes.condition).toBeNull()
      }
    }
  )

  it('normalises hedgerows without changing an unknown intervention type', () => {
    const document = {
      hedgerows: [
        {
          retentionCategory: 'Unknown',
          baseline: { type: 'Native hedgerow', condition: 'bad' },
          proposed: {
            type: 'bad',
            condition: 'Good',
            advanceYears: 2,
            delayYears: 1
          }
        }
      ]
    }
    normaliseImportedDocument(document, true)
    expect(document.hedgerows[0].retentionCategory).toBe('Unknown')
    expect(document.hedgerows[0].baseline).toMatchObject({
      type: 'Native hedgerow',
      condition: null
    })
    expect(document.hedgerows[0].proposed).toMatchObject({
      type: null,
      condition: null,
      advanceYears: null,
      delayYears: null
    })
  })
})
