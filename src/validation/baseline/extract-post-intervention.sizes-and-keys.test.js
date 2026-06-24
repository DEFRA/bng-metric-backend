import { describe, expect, it } from 'vitest'

import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-metric-engine'

import { extractPostIntervention } from './extract-post-intervention.js'
import {
  FEAT_ID_AREA,
  FEAT_ID_HEDGE,
  FEAT_ID_WC,
  HABITAT_SQM,
  HEDGEROW_M,
  PARCEL_REF,
  SAMPLE_LINESTRING,
  UUID_REGEX,
  WATERCOURSE_M,
  feature
} from './extract-post-intervention.test-fixtures.js'

describe('extractPostIntervention — habitatSizes embedding', () => {
  it('embeds sizeSquareMetres and area onto habitat documents from PostGIS sizes', () => {
    const habitatSizes = {
      areaHabitats: {
        individualSquareMetres: [
          { featureId: FEAT_ID_AREA, sizeSquareMetres: HABITAT_SQM }
        ],
        totalSquareMetres: HABITAT_SQM
      },
      hedgerows: { individualMetres: [], totalMetres: 0 },
      watercourses: { individualMetres: [], totalMetres: 0 }
    }
    const out = extractPostIntervention(
      {
        redline: [],
        areas: [
          { ...feature({ [PARCEL_REF]: 'P1' }), featureId: FEAT_ID_AREA }
        ],
        hedgerows: [],
        watercourses: []
      },
      { habitatSizes }
    )

    expect(out.document.habitats[0].sizeSquareMetres).toBe(HABITAT_SQM)
    expect(out.document.habitats[0].area).toBe(HABITAT_SQM)
    expect(out.document.habitatSizes).toEqual({
      // No trees in this fixture, so the area-habitats total equals the parcel
      // total and the site total (which excludes trees) matches it.
      areaHabitats: { totalSquareMetres: HABITAT_SQM },
      hedgerows: { totalMetres: 0 },
      watercourses: { totalMetres: 0 },
      trees: {
        totalSquareMetres: 0,
        urbanSquareMetres: 0,
        ruralSquareMetres: 0
      },
      site: { totalSquareMetres: HABITAT_SQM }
    })
  })

  it('sets area to null when PostGIS size is not a finite number', () => {
    const habitatSizes = {
      areaHabitats: {
        individualSquareMetres: [
          { featureId: FEAT_ID_AREA, sizeSquareMetres: Number.NaN }
        ],
        totalSquareMetres: 0
      },
      hedgerows: { individualMetres: [], totalMetres: 0 },
      watercourses: { individualMetres: [], totalMetres: 0 }
    }
    const out = extractPostIntervention(
      {
        redline: [],
        areas: [
          { ...feature({ [PARCEL_REF]: 'P1' }), featureId: FEAT_ID_AREA }
        ],
        hedgerows: [],
        watercourses: []
      },
      { habitatSizes }
    )

    expect(out.document.habitats[0].sizeSquareMetres).toBe(Number.NaN)
    expect(out.document.habitats[0].area).toBeNull()
  })

  it('embeds sizeMetres and length onto hedgerow documents', () => {
    const habitatSizes = {
      areaHabitats: { individualSquareMetres: [], totalSquareMetres: 0 },
      hedgerows: {
        individualMetres: [
          { featureId: FEAT_ID_HEDGE, sizeMetres: HEDGEROW_M }
        ],
        totalMetres: HEDGEROW_M
      },
      watercourses: { individualMetres: [], totalMetres: 0 }
    }
    const out = extractPostIntervention(
      {
        redline: [],
        areas: [],
        hedgerows: [
          {
            ...feature({ [PARCEL_REF]: 'H1' }, SAMPLE_LINESTRING),
            featureId: FEAT_ID_HEDGE
          }
        ],
        watercourses: []
      },
      { habitatSizes }
    )

    expect(out.document.hedgerows[0].sizeMetres).toBe(HEDGEROW_M)
    expect(out.document.hedgerows[0].length).toBe(HEDGEROW_M)
  })

  it('embeds sizeMetres onto watercourse documents', () => {
    const habitatSizes = {
      areaHabitats: { individualSquareMetres: [], totalSquareMetres: 0 },
      hedgerows: { individualMetres: [], totalMetres: 0 },
      watercourses: {
        individualMetres: [
          { featureId: FEAT_ID_WC, sizeMetres: WATERCOURSE_M }
        ],
        totalMetres: WATERCOURSE_M
      }
    }
    const out = extractPostIntervention(
      {
        redline: [],
        areas: [],
        hedgerows: [],
        watercourses: [
          {
            ...feature({ [PARCEL_REF]: 'W1' }, SAMPLE_LINESTRING),
            featureId: FEAT_ID_WC
          }
        ]
      },
      { habitatSizes }
    )

    expect(out.document.watercourses[0].sizeMetres).toBe(WATERCOURSE_M)
  })
})

describe('extractPostIntervention — featureId join keys', () => {
  it('assigns UUID featureIds matched between document and geometry halves', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [feature({ [PARCEL_REF]: 'P1' })],
      hedgerows: [feature({ [PARCEL_REF]: 'H1' }, SAMPLE_LINESTRING)],
      watercourses: [feature({ [PARCEL_REF]: 'W1' }, SAMPLE_LINESTRING)]
    })

    expect(out.document.habitats[0].featureId).toMatch(UUID_REGEX)
    expect(out.document.habitats[0].featureId).toBe(
      out.geometries.habitats[0].featureId
    )
    expect(out.document.hedgerows[0].featureId).toBe(
      out.geometries.hedgerows[0].featureId
    )
    expect(out.document.watercourses[0].featureId).toBe(
      out.geometries.watercourses[0].featureId
    )
  })

  it('preserves an existing redLine featureId on document and geometry halves', () => {
    const redLineFeatureId = '11111111-1111-1111-1111-111111111111'
    const out = extractPostIntervention({
      redline: [
        {
          ...feature({ [PARCEL_REF]: 'RL1' }),
          featureId: redLineFeatureId
        }
      ],
      areas: [],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.redLine.featureId).toBe(redLineFeatureId)
    expect(out.geometries.redLine.featureId).toBe(redLineFeatureId)
  })

  it('assigns a UUID when a habitat feature has no featureId yet', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [feature({ [PARCEL_REF]: 'H9' })],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].featureId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(out.document.habitats[0].featureId).toBe(
      out.geometries.habitats[0].featureId
    )
  })
})

describe('extractPostIntervention — graceful inputs', () => {
  it('handles missing layer arrays gracefully', () => {
    const out = extractPostIntervention({})

    expect(out.document.redLine).toBeNull()
    expect(out.document.habitats).toEqual([])
    expect(out.document.hedgerows).toEqual([])
    expect(out.document.watercourses).toEqual([])
  })

  it('returns null for missing proposed fields rather than undefined', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [feature({})],
      hedgerows: [],
      watercourses: []
    })

    const hab = out.document.habitats[0]
    expect(hab.proposed.type).toBeNull()
    expect(hab.proposed.broadType).toBeNull()
    expect(hab.proposed.condition).toBeNull()
    expect(hab.baseline.type).toBeNull()
    expect(hab.baseline.retentionCategory).toBeNull()
  })

  it('treats a feature with no properties key as having empty properties', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        {
          nativeGeometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0]
              ]
            ]
          },
          nativeSrid: 27700
        }
      ],
      hedgerows: [],
      watercourses: []
    })

    const hab = out.document.habitats[0]
    expect(hab.ref).toBeNull()
    expect(hab.baseline.type).toBeNull()
  })
})

describe('extractPostIntervention — advance/delay parsing', () => {
  it(`maps ${MAX_YEARS_PLUS} advance years to ${MAX_YEARS}`, () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Habitat created in advance/years': MAX_YEARS_PLUS,
          'Delay in starting habitat creation/years': MAX_YEARS_PLUS
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].proposed.advanceYears).toBe(MAX_YEARS)
    expect(out.document.habitats[0].proposed.delayYears).toBe(MAX_YEARS)
  })

  it('maps non-string advance/delay property values to null', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Habitat created in advance/years': { invalid: true },
          'Delay in starting habitat creation/years': false
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].proposed.advanceYears).toBeNull()
    expect(out.document.habitats[0].proposed.delayYears).toBeNull()
  })

  it('maps non-finite numeric advance years to null', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Habitat created in advance/years': Number.POSITIVE_INFINITY
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].proposed.advanceYears).toBeNull()
  })

  it('maps unparseable string advance years to null', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Habitat created in advance/years': 'not-a-number'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].proposed.advanceYears).toBeNull()
  })

  it('passes through a finite integer advance years value directly', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Habitat created in advance/years': 5
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].proposed.advanceYears).toBe(5)
  })
})

describe('extractPostIntervention — habitatSizes missing featureId fallback', () => {
  it('sets sizeSquareMetres to null when habitat featureId is absent from sizes', () => {
    const habitatSizes = {
      areaHabitats: {
        individualSquareMetres: [],
        totalSquareMetres: 0
      },
      hedgerows: { individualMetres: [], totalMetres: 0 },
      watercourses: { individualMetres: [], totalMetres: 0 }
    }
    const out = extractPostIntervention(
      {
        redline: [],
        areas: [
          { ...feature({ [PARCEL_REF]: 'P1' }), featureId: FEAT_ID_AREA }
        ],
        hedgerows: [],
        watercourses: []
      },
      { habitatSizes }
    )

    expect(out.document.habitats[0].sizeSquareMetres).toBeNull()
    expect(out.document.habitats[0].area).toBeNull()
  })

  it('sets sizeMetres and length to null when hedgerow featureId is absent from sizes', () => {
    const habitatSizes = {
      areaHabitats: { individualSquareMetres: [], totalSquareMetres: 0 },
      hedgerows: { individualMetres: [], totalMetres: 0 },
      watercourses: { individualMetres: [], totalMetres: 0 }
    }
    const out = extractPostIntervention(
      {
        redline: [],
        areas: [],
        hedgerows: [
          {
            ...feature({ [PARCEL_REF]: 'H1' }, SAMPLE_LINESTRING),
            featureId: FEAT_ID_HEDGE
          }
        ],
        watercourses: []
      },
      { habitatSizes }
    )

    expect(out.document.hedgerows[0].sizeMetres).toBeNull()
    expect(out.document.hedgerows[0].length).toBeNull()
  })
})
