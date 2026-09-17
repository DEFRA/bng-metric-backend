import { describe, expect, test, vi } from 'vitest'

import {
  attributesOf,
  buildSite,
  cappedLayers,
  joinLayer,
  readSiteData
} from './site-data.js'

vi.mock('../../db/project-geometry.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, readProjectGeometry: vi.fn() }
})

const { readProjectGeometry } = await import('../../db/project-geometry.js')

const SQUARE = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0]
      ]
    ]
  ]
}

function emptyGeometry(overrides = {}) {
  return {
    redLine: null,
    redLineAreaSqm: 0,
    layers: { habitats: [], hedgerows: [], watercourses: [], trees: [] },
    ...overrides
  }
}

describe('#attributesOf', () => {
  test('reads a baseline feature straight off the document', () => {
    expect(
      attributesOf({
        ref: 'A1',
        type: 'Modified grassland',
        condition: 'Poor',
        sizeSquareMetres: 10_000
      })
    ).toEqual({
      ref: 'A1',
      type: 'Modified grassland',
      broadType: null,
      condition: 'Poor',
      distinctiveness: null,
      strategicSignificance: null,
      retentionCategory: null,
      units: null,
      sizeSquareMetres: 10_000,
      sizeMetres: null,
      distinctivenessScore: null,
      conditionScore: null,
      difficulty: null,
      difficultyMultiplier: null,
      standardTimeToTargetCondition: null,
      finalTimeToTargetCondition: null,
      advanceOrDelay: null,
      spatialRiskCategory: null,
      status: null,
      surveyDate: null,
      surveyDetails: null,
      comment: null
    })
  })

  test('prefers the proposed values on a post-intervention feature', () => {
    // The post-intervention document keeps the baseline values alongside the
    // proposed ones. The report is about what the parcel will become.
    const attributes = attributesOf({
      ref: 'A1',
      type: 'Cereal crops',
      condition: 'Poor',
      sizeSquareMetres: 10_000,
      proposed: { type: 'Other neutral grassland', condition: 'Good' }
    })

    expect(attributes.type).toBe('Other neutral grassland')
    expect(attributes.condition).toBe('Good')
  })

  test('carries a missing value through as null rather than inventing one', () => {
    expect(attributesOf({})).toEqual({
      ref: null,
      type: null,
      broadType: null,
      condition: null,
      distinctiveness: null,
      strategicSignificance: null,
      retentionCategory: null,
      units: null,
      sizeSquareMetres: null,
      sizeMetres: null,
      distinctivenessScore: null,
      conditionScore: null,
      difficulty: null,
      difficultyMultiplier: null,
      standardTimeToTargetCondition: null,
      finalTimeToTargetCondition: null,
      advanceOrDelay: null,
      spatialRiskCategory: null,
      status: null,
      surveyDate: null,
      surveyDetails: null,
      comment: null
    })
  })

  test('carries the enriched values the card layout shows', () => {
    // distinctiveness and units are written back by the enrichment step from
    // the metric engine, so they exist only on a calculated project.
    const attributes = attributesOf({
      ref: 'A1',
      type: 'Modified grassland',
      broadType: 'Grassland',
      condition: 'Poor',
      distinctiveness: 'Low',
      strategicSignificance: 'Location ecologically desirable',
      retentionCategory: 'Retained',
      units: 3.6
    })

    expect(attributes).toMatchObject({
      broadType: 'Grassland',
      distinctiveness: 'Low',
      strategicSignificance: 'Location ecologically desirable',
      retentionCategory: 'Retained',
      units: 3.6
    })
  })

  test('prefers proposed values for the enriched fields too', () => {
    const attributes = attributesOf({
      distinctiveness: 'Low',
      units: 3.6,
      proposed: { distinctiveness: 'Medium', units: 8.2 }
    })

    expect(attributes.distinctiveness).toBe('Medium')
    expect(attributes.units).toBe(8.2)
  })

  test('carries the calculation fields the card layout shows', () => {
    // The "how was this number arrived at" set. Written by the enrichment step
    // onto `proposed`, so they exist only on a calculated post-intervention
    // feature — which is why every one of them is optional on a card.
    const attributes = attributesOf({
      ref: 'A1',
      proposed: {
        condition: 'Good',
        conditionScore: 3,
        distinctiveness: 'Medium',
        distinctivenessScore: 4,
        difficulty: 'Medium',
        difficultyMultiplier: 0.67,
        standardTimeToTargetCondition: '10',
        finalTimeToTargetCondition: '8 years (0.7)',
        advanceOrDelay: 'Advance - 2 years'
      }
    })

    expect(attributes).toMatchObject({
      conditionScore: 3,
      distinctivenessScore: 4,
      difficulty: 'Medium',
      difficultyMultiplier: 0.67,
      standardTimeToTargetCondition: '10',
      finalTimeToTargetCondition: '8 years (0.7)',
      advanceOrDelay: 'Advance - 2 years'
    })
  })

  test('reads the surveyed-and-recorded fields off the feature itself', () => {
    // These come from the GeoPackage columns rather than the engine, so they
    // are read from the feature and never from `proposed`.
    const attributes = attributesOf({
      spatialRiskCategory: 'Within LPA',
      status: 'Complete',
      surveyDate: '2025-06-14',
      surveyDetails: 'UKHab survey, dry conditions.',
      comment: 'Adjoins the watercourse on the north edge.',
      proposed: { spatialRiskCategory: 'Ignored' }
    })

    expect(attributes).toMatchObject({
      spatialRiskCategory: 'Within LPA',
      status: 'Complete',
      surveyDate: '2025-06-14',
      surveyDetails: 'UKHab survey, dry conditions.',
      comment: 'Adjoins the watercourse on the north edge.'
    })
  })

  test('rejects a non-finite difficulty multiplier the way it rejects units', () => {
    expect(
      attributesOf({ difficultyMultiplier: Number.NaN }).difficultyMultiplier
    ).toBeNull()
  })

  test('rejects non-finite units the same way it rejects a bad size', () => {
    expect(attributesOf({ units: Number.NaN }).units).toBeNull()
  })

  test('rejects a non-finite size instead of formatting NaN onto the page', () => {
    expect(
      attributesOf({ sizeSquareMetres: Number.NaN }).sizeSquareMetres
    ).toBeNull()
  })
})

describe('#joinLayer', () => {
  test('matches attributes to geometry by featureId, not by order', () => {
    const joined = joinLayer(
      [
        { featureId: 'b', ref: 'A2' },
        { featureId: 'a', ref: 'A1' }
      ],
      [
        { featureId: 'a', geometry: SQUARE },
        { featureId: 'b', geometry: SQUARE }
      ]
    )

    expect(joined.map((feature) => feature.properties.ref)).toEqual([
      'A2',
      'A1'
    ])
  })

  test('drops a feature with no geometry rather than drawing nothing somewhere', () => {
    const joined = joinLayer([{ featureId: 'ghost', ref: 'A9' }], [])

    expect(joined).toEqual([])
  })

  test('drops geometry with no attributes rather than listing a blank row', () => {
    const joined = joinLayer([], [{ featureId: 'orphan', geometry: SQUARE }])

    expect(joined).toEqual([])
  })

  test('treats a missing layer as empty', () => {
    expect(joinLayer(undefined, [])).toEqual([])
  })
})

describe('#buildSite', () => {
  test('returns null when the document has no such side', () => {
    expect(buildSite(null, emptyGeometry(), 'Test Farm')).toBeNull()
  })

  test('carries the units through untouched', () => {
    const units = { habitatsTotal: 12.5 }

    const site = buildSite({ units }, emptyGeometry(), 'Test Farm')

    expect(site.units).toBe(units)
    expect(site.siteName).toBe('Test Farm')
  })

  test('builds every layer, even the ones the document does not mention', () => {
    const site = buildSite({}, emptyGeometry(), 'Test Farm')

    expect(Object.keys(site.layers).sort()).toEqual([
      'habitats',
      'hedgerows',
      'trees',
      'watercourses'
    ])
  })
})

describe('#attributesOf blank proposed values', () => {
  test('falls back to the baseline when a proposed value is blank', () => {
    // A blank proposed value means "not proposed", not "proposed to be
    // blank". `??` accepts the empty string as an answer and suppresses the
    // baseline behind it, which reported a parcel with no type and no
    // condition while the screen showed both. Raised in review on #297.
    const attributes = attributesOf({
      type: 'Baseline type',
      condition: 'Poor',
      proposed: { type: '', condition: '' }
    })

    expect(attributes.type).toBe('Baseline type')
    expect(attributes.condition).toBe('Poor')
  })

  test('applies the same rule to every proposed field, numbers included', () => {
    const attributes = attributesOf({
      distinctiveness: 'Low',
      distinctivenessScore: 2,
      units: 3.6,
      retentionCategory: 'Retained',
      proposed: {
        distinctiveness: '',
        distinctivenessScore: '',
        units: '',
        retentionCategory: ''
      }
    })

    expect(attributes.distinctiveness).toBe('Low')
    expect(attributes.distinctivenessScore).toBe(2)
    expect(attributes.units).toBe(3.6)
    expect(attributes.retentionCategory).toBe('Retained')
  })

  test('still prefers a proposed value that is genuinely there', () => {
    // The blank test must not swallow real answers — including falsy ones a
    // careless truthiness check would drop.
    const attributes = attributesOf({
      type: 'Baseline type',
      units: 3.6,
      proposed: { type: 'Proposed type', units: 0 }
    })

    expect(attributes.type).toBe('Proposed type')
    expect(attributes.units).toBe(0)
  })

  test('reports a blank baseline value as it stands, like the screen', () => {
    // The frontend's sourceValue returns the feature's own value untested, so
    // a blank at the top level reaches the page as a blank. The report says
    // the same thing rather than inventing an absence.
    expect(attributesOf({ type: '' }).type).toBe('')
  })
})

describe('#documentCounts', () => {
  test('counts what the project holds, not what the report drew', () => {
    const site = buildSite(
      {
        habitats: [{ featureId: 'f1' }, { featureId: 'f2' }],
        hedgerows: [{ featureId: 'f3' }]
      },
      emptyGeometry(),
      'Test Farm'
    )

    // None of these joined to geometry, so the report draws nothing — but the
    // project still holds them, and the summary tiles decide whether a site
    // has hedgerows at all from this.
    expect(site.layers.habitats).toEqual([])
    expect(site.documentCounts).toEqual({
      habitats: 2,
      hedgerows: 1,
      watercourses: 0,
      trees: 0
    })
  })
})

describe('#cappedLayers', () => {
  test('is empty for a site that arrived whole', () => {
    const site = buildSite({ habitats: [] }, emptyGeometry(), 'Test Farm')

    expect(site.capped).toEqual([])
  })

  test('counts what is shown against what the project holds', () => {
    const document = {
      habitats: [
        { featureId: 'f1', ref: 'A1' },
        { featureId: 'f2', ref: 'A2' },
        { featureId: 'f3', ref: 'A3' }
      ]
    }
    const geometry = emptyGeometry({
      cappedLayers: ['habitats'],
      layers: {
        habitats: [
          { featureId: 'f1', geometry: SQUARE },
          { featureId: 'f2', geometry: SQUARE }
        ],
        hedgerows: [],
        watercourses: [],
        trees: []
      }
    })

    // The denominator is the document's own list, which this request has
    // already read — so the report can say "2 of 3" without a second query
    // per layer counting rows PostGIS was told not to return.
    expect(cappedLayers(document, geometry, { habitats: [{}, {}] })).toEqual([
      { layer: 'habitats', shown: 2, total: 3 }
    ])
    expect(buildSite(document, geometry, 'Test Farm').capped).toEqual([
      { layer: 'habitats', shown: 2, total: 3 }
    ])
  })
})

describe('#readSiteData', () => {
  test('reads only the baseline when there is no post-intervention document', async () => {
    readProjectGeometry.mockResolvedValue(emptyGeometry())

    const site = await readSiteData(
      {},
      {
        id: 'project-1',
        project: { name: 'Test Farm', baseline: { habitats: [] } }
      }
    )

    expect(site.postIntervention).toBeNull()
    expect(readProjectGeometry).toHaveBeenCalledTimes(1)
    expect(readProjectGeometry).toHaveBeenCalledWith(
      {},
      'project-1',
      'baseline'
    )
  })

  test('reads both sides when the project has both', async () => {
    readProjectGeometry.mockResolvedValue(emptyGeometry())

    const site = await readSiteData(
      {},
      {
        id: 'project-1',
        project: {
          name: 'Test Farm',
          baseline: { habitats: [] },
          postIntervention: { habitats: [] }
        }
      }
    )

    expect(site.baseline).not.toBeNull()
    expect(site.postIntervention).not.toBeNull()
    expect(readProjectGeometry).toHaveBeenCalledTimes(2)
  })

  test('falls back to a generic site name rather than rendering "undefined"', async () => {
    readProjectGeometry.mockResolvedValue(emptyGeometry())

    const site = await readSiteData({}, { id: 'project-1', project: {} })

    expect(site.siteName).toBe('BNG site')
  })
})
