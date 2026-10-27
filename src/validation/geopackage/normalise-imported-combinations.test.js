import { describe, expect, it } from 'vitest'
import {
  CONDITION_SCORES,
  HEDGEROW_CONDITION_SCORES,
  WATERCOURSE_CONDITION_SCORES
} from 'bng-library/metric'
import { normaliseProposedCombinations } from './post-intervention/normalise-proposed-combinations.js'
import { normaliseImportedCombinations } from './normalise-imported-combinations.js'
import { normaliseImportedDocument } from './normalise-imported-attributes.js'
import { extractPostIntervention } from './post-intervention/extract-post-intervention.js'

function applyCombinations(document, postIntervention = false) {
  return postIntervention
    ? normaliseProposedCombinations(document)
    : normaliseImportedCombinations(document)
}

const STRATEGIC = 'High'
function area(overrides = {}) {
  return {
    broadType: 'Grassland',
    type: 'Modified grassland',
    condition: 'Good',
    ...overrides
  }
}
function normalise(document, proposed = false) {
  normaliseImportedDocument(document, proposed)
  return applyCombinations(document, proposed)
}

describe('BMD-1060 import combinations', () => {
  it.each(['Modified grassland', 'Grassland - Modified grassland'])(
    'AC1 retains a valid broad/type pair using %s',
    (type) => {
      const feature = area({ type })
      const original = structuredClone(feature)
      normalise({ habitats: [feature] })
      expect(feature).toEqual(original)
    }
  )

  it.each(['Mixed scrub', 'Heathland and shrub - Mixed scrub'])(
    'AC1 nulls inconsistent %s and linked baseline attributes only',
    (type) => {
      const feature = area({
        type,
        strategicSignificance: STRATEGIC,
        advanceYears: 2,
        delayYears: 0,
        watercourseEncroachment: 'value',
        riparianEncroachment: 'value'
      })
      normalise({ habitats: [feature] })
      expect(feature).toEqual({
        broadType: 'Grassland',
        type: null,
        condition: null,
        strategicSignificance: STRATEGIC,
        advanceYears: null,
        delayYears: null,
        watercourseEncroachment: null,
        riparianEncroachment: null
      })
    }
  )

  it.each(['Created', 'Enhanced', 'Retained', 'Lost'])(
    'AC1 applies strategic-significance cascade only to Created/Enhanced: %s',
    (retentionCategory) => {
      const feature = {
        retentionCategory,
        baseline: area(),
        proposed: area({
          type: 'Mixed scrub',
          strategicSignificance: STRATEGIC,
          advanceYears: 2,
          delayYears: 0
        }),
        properties: {
          'Retention Category': retentionCategory,
          'Proposed Habitat Type': 'Mixed scrub'
        }
      }
      const raw = structuredClone(feature.properties)
      normalise({ habitats: [feature] }, true)
      expect(feature.baseline).toEqual(area())
      expect(feature.proposed).toEqual({
        broadType: 'Grassland',
        type: null,
        condition: null,
        strategicSignificance: ['Created', 'Enhanced'].includes(
          retentionCategory
        )
          ? null
          : STRATEGIC,
        advanceYears: null,
        delayYears: null
      })
      expect(feature.properties).toEqual(raw)
    }
  )

  it.each([
    ['habitats', CONDITION_SCORES],
    ['trees', CONDITION_SCORES],
    ['hedgerows', HEDGEROW_CONDITION_SCORES],
    ['watercourses', WATERCOURSE_CONDITION_SCORES]
  ])(
    'AC2 follows every condition reference entry for %s on both upload types',
    (layer, table) => {
      for (const [key, conditions] of Object.entries(table)) {
        const areaLayer = layer === 'habitats' || layer === 'trees'
        const split = key.indexOf(' - ')
        const identity = areaLayer
          ? { broadType: key.slice(0, split), type: key.slice(split + 3) }
          : { type: key }
        for (const [condition, score] of Object.entries(conditions)) {
          for (const postIntervention of [false, true]) {
            const attributes = {
              ...identity,
              condition,
              strategicSignificance: STRATEGIC
            }
            const feature = postIntervention
              ? { proposed: attributes }
              : attributes
            applyCombinations({ [layer]: [feature] }, postIntervention)
            expect(attributes).toEqual({
              ...identity,
              condition: score === 'Not Possible' ? null : condition,
              strategicSignificance: STRATEGIC
            })
          }
        }
      }
    }
  )

  it('AC2 validates the baseline and proposed sides independently', () => {
    const feature = {
      baseline: { type: 'Culvert', condition: 'Moderate' },
      proposed: {
        type: 'Ditches',
        condition: 'Good',
        watercourseEncroachment: 'No Encroachment'
      }
    }
    applyCombinations({ watercourses: [feature] }, true)
    expect(feature.baseline).toEqual({ type: 'Culvert', condition: null })
    expect(feature.proposed.condition).toBe('Good')
    expect(feature.proposed.watercourseEncroachment).toBe('No Encroachment')
  })

  it.each(['Created', 'Enhanced'])(
    'AC3/AC4 preserve timing boundaries for %s across layers',
    (retentionCategory) => {
      for (const layer of ['habitats', 'trees', 'hedgerows', 'watercourses']) {
        for (const [advanceYears, delayYears, expected] of [
          [1, 2, [null, null]],
          [0.5, 0.25, [null, null]],
          [0, 0, [0, 0]],
          [2, 0, [2, 0]],
          [0, 2, [0, 2]],
          [null, null, [null, null]],
          [null, 2, [null, 2]],
          [-1, 2, [-1, 2]]
        ]) {
          const proposed = { advanceYears, delayYears }
          applyCombinations(
            { [layer]: [{ retentionCategory, proposed }] },
            true
          )
          expect([proposed.advanceYears, proposed.delayYears]).toEqual(expected)
        }
      }
    }
  )

  it.each(['Retained', 'Lost'])(
    'AC5 removes timing from %s except Lost area replacements',
    (retentionCategory) => {
      for (const layer of ['habitats', 'trees', 'hedgerows', 'watercourses']) {
        if (layer === 'habitats' && retentionCategory === 'Lost') {
          continue
        }
        for (const values of [
          [2, 3],
          [0, 0],
          [null, 2]
        ]) {
          const proposed = { advanceYears: values[0], delayYears: values[1] }
          applyCombinations(
            { [layer]: [{ retentionCategory, proposed }] },
            true
          )
          expect(proposed).toEqual({ advanceYears: null, delayYears: null })
        }
      }
    }
  )

  it('AC5 preserves timing on Lost area rows mapped to Created by extraction', () => {
    const { document } = extractPostIntervention({
      areas: [
        {
          properties: {
            'Retention Category': '4. Lost',
            'Habitat created in advance/years': 3,
            'Delay in starting habitat creation/years': 0
          }
        }
      ]
    })
    expect(document.habitats[0].retentionCategory).toBe('Created')
    expect(document.habitats[0].proposed).toMatchObject({
      advanceYears: 3,
      delayYears: 0
    })
    applyCombinations(document, true)
    expect(document.habitats[0].proposed).toMatchObject({
      advanceYears: 3,
      delayYears: 0
    })
  })

  it('leaves timing on unknown interventions unchanged and tolerates missing sides', () => {
    const document = {
      habitats: [
        {},
        {
          retentionCategory: 'Unknown',
          proposed: { advanceYears: 2, delayYears: 3 }
        }
      ]
    }
    expect(applyCombinations(document, true)).toEqual(document)
    expect(document.habitats[1].proposed).toEqual({
      advanceYears: 2,
      delayYears: 3
    })
    expect(applyCombinations({})).toEqual({})
  })
})
