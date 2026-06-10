import { describe, expect, it } from 'vitest'

import { extractBaseline } from './extract-baseline.js'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const BNG_SRID = 27700
const WGS84_SRID = 4326
const PARCEL_REF = 'Parcel Ref'
const HABITAT_TYPE = 'Baseline Habitat Type'
const HEDGEROW_TYPE = 'Baseline Hedge Type'
const RIVER_TYPE = 'Baseline River Type'
const CONDITION = 'Baseline Condition'
const LOWLAND_MEADOWS = 'Grassland - Lowland meadows'

const HABITAT_SQM = 5000
const HEDGEROW_M = 120
const UPLOADED_FILE_SIZE = 204800

const FEAT_ID_AREA = 'featarea-0000-0000-0000-000000000000'
const FEAT_ID_HEDGE = 'featheg0-0000-0000-0000-000000000000'
const FEAT_ID_WC = 'featwc00-0000-0000-0000-000000000000'
const WATERCOURSE_M = 250

const SAMPLE_POLYGON = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0]
    ]
  ]
}

const SAMPLE_LINESTRING = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [1, 1]
  ]
}

function feature(properties, geometry = SAMPLE_POLYGON, srid = BNG_SRID) {
  return {
    type: 'Feature',
    properties,
    nativeGeometry: geometry,
    nativeSrid: srid
  }
}

describe('extractBaseline — top-level shape', () => {
  it('returns both a document and geometries half', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: []
    })

    expect(out).toEqual(
      expect.objectContaining({
        document: expect.objectContaining({
          uploadId: null,
          importedAt: expect.any(String),
          redLine: null,
          habitats: [],
          hedgerows: [],
          watercourses: [],
          habitatSizes: null
        }),
        geometries: {
          redLine: null,
          habitats: [],
          hedgerows: [],
          watercourses: []
        }
      })
    )
    expect(() => new Date(out.document.importedAt).toISOString()).not.toThrow()
  })

  it('threads uploadId and importedAt from meta into the document half only', () => {
    const out = extractBaseline(
      { redline: [], areas: [], hedgerows: [], watercourses: [] },
      { uploadId: 'u-123', importedAt: '2026-05-08T10:00:00.000Z' }
    )

    expect(out.document.uploadId).toBe('u-123')
    expect(out.document.importedAt).toBe('2026-05-08T10:00:00.000Z')
    expect(out.geometries).not.toHaveProperty('uploadId')
  })

  it('threads filename and fileSize from meta into the document', () => {
    const out = extractBaseline(
      { redline: [], areas: [], hedgerows: [], watercourses: [] },
      { filename: 'survey.gpkg', fileSize: UPLOADED_FILE_SIZE }
    )

    expect(out.document.filename).toBe('survey.gpkg')
    expect(out.document.fileSize).toBe(UPLOADED_FILE_SIZE)
    expect(out.geometries).not.toHaveProperty('filename')
    expect(out.geometries).not.toHaveProperty('fileSize')
  })

  it('sets filename and fileSize to null when absent from meta', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.filename).toBeNull()
    expect(out.document.fileSize).toBeNull()
  })
})

describe('extractBaseline — habitatSizes embedding', () => {
  it('embeds per-feature sizes and stores totals summary in habitatSizes', () => {
    const habitatSizes = {
      areaHabitats: {
        individualSquareMetres: [
          {
            featureId: FEAT_ID_AREA,
            sizeSquareMetres: HABITAT_SQM
          }
        ],
        totalSquareMetres: HABITAT_SQM
      },
      hedgerows: {
        individualMetres: [
          {
            featureId: FEAT_ID_HEDGE,
            sizeMetres: HEDGEROW_M
          }
        ],
        totalMetres: HEDGEROW_M
      },
      watercourses: { individualMetres: [], totalMetres: 0 }
    }
    const out = extractBaseline(
      {
        redline: [],
        areas: [
          { ...feature({ [PARCEL_REF]: 'P1' }), featureId: FEAT_ID_AREA }
        ],
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

    // Per-feature sizes embedded directly in each feature document
    expect(out.document.habitats[0].sizeSquareMetres).toBe(HABITAT_SQM)
    expect(out.document.habitats[0].area).toBe(HABITAT_SQM)
    expect(out.document.hedgerows[0].sizeMetres).toBe(HEDGEROW_M)

    // Top-level habitatSizes holds totals only (no individual arrays)
    expect(out.document.habitatSizes).toEqual({
      areaHabitats: { totalSquareMetres: HABITAT_SQM },
      hedgerows: { totalMetres: HEDGEROW_M },
      watercourses: { totalMetres: 0 }
    })

    // Geometry half is untouched
    expect(out.geometries).not.toHaveProperty('habitatSizes')
  })

  it('embeds sizeMetres from habitatSizes onto watercourse documents', () => {
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
    const out = extractBaseline(
      {
        redline: [],
        areas: [],
        hedgerows: [],
        watercourses: [
          {
            ...feature(
              {
                [PARCEL_REF]: 'W1',
                'Baseline River Type': 'Priority habitat',
                [CONDITION]: 'Good'
              },
              SAMPLE_LINESTRING
            ),
            featureId: FEAT_ID_WC
          }
        ]
      },
      { habitatSizes }
    )
    expect(out.document.watercourses[0].sizeMetres).toBe(WATERCOURSE_M)
    expect(out.document.habitatSizes.watercourses.totalMetres).toBe(
      WATERCOURSE_M
    )
  })

  it('sets sizeSquareMetres/sizeMetres to null for features with no geometry in sizes result', () => {
    const habitatSizes = {
      areaHabitats: { individualSquareMetres: [], totalSquareMetres: 0 },
      hedgerows: { individualMetres: [], totalMetres: 0 },
      watercourses: { individualMetres: [], totalMetres: 0 }
    }
    const out = extractBaseline(
      {
        redline: [],
        areas: [feature({ [PARCEL_REF]: 'P1' })],
        hedgerows: [],
        watercourses: []
      },
      { habitatSizes }
    )

    expect(out.document.habitats[0].sizeSquareMetres).toBeNull()
    expect(out.document.habitats[0].area).toBeNull()
  })

  it('sets area from PostGIS sizeSquareMetres rounded to the nearest integer', () => {
    const habitatSizes = {
      areaHabitats: {
        individualSquareMetres: [
          {
            featureId: FEAT_ID_AREA,
            sizeSquareMetres: 5000.6
          }
        ],
        totalSquareMetres: 5000.6
      },
      hedgerows: { individualMetres: [], totalMetres: 0 },
      watercourses: { individualMetres: [], totalMetres: 0 }
    }
    const out = extractBaseline(
      {
        redline: [],
        areas: [
          {
            ...feature({ [PARCEL_REF]: 'P1', Area: 4999 }),
            featureId: FEAT_ID_AREA
          }
        ],
        hedgerows: [],
        watercourses: []
      },
      { habitatSizes }
    )

    expect(out.document.habitats[0].sizeSquareMetres).toBe(5000.6)
    expect(out.document.habitats[0].area).toBe(5001)
    expect(out.document.habitats[0].properties.Area).toBe(4999)
  })

  it('sets habitatSizes to null when not provided', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: []
    })
    expect(out.document.habitatSizes).toBeNull()
  })
})

describe('extractBaseline — featureId join keys', () => {
  it('assigns a UUID featureId to every feature, matched between document and geometry halves', () => {
    const out = extractBaseline({
      redline: [feature({ name: 'r' })],
      areas: [feature({ [PARCEL_REF]: 'P1' })],
      hedgerows: [feature({ [PARCEL_REF]: 'H1' }, SAMPLE_LINESTRING)],
      watercourses: [feature({ [PARCEL_REF]: 'W1' }, SAMPLE_LINESTRING)]
    })

    expect(out.document.redLine.featureId).toMatch(UUID_REGEX)
    expect(out.document.redLine.featureId).toBe(
      out.geometries.redLine.featureId
    )

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

  it('produces a unique featureId per feature within the same layer', () => {
    const out = extractBaseline({
      redline: [],
      areas: [feature({ [PARCEL_REF]: 'P1' }), feature({ [PARCEL_REF]: 'P2' })],
      hedgerows: [],
      watercourses: []
    })

    const [a, b] = out.document.habitats
    expect(a.featureId).not.toBe(b.featureId)
  })
})

describe('extractBaseline — habitat document fields and shape', () => {
  it('extracts habitat fields per parcel: ref, type, condition, plus retention/strategic significance', () => {
    const out = extractBaseline({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          [HABITAT_TYPE]: LOWLAND_MEADOWS,
          'Baseline Broad Habitat Type': 'Grassland',
          [CONDITION]: 'Good',
          'Baseline Strategic Significance': 'High',
          'Retention Category': 'Retain',
          Area: 1.23
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats).toHaveLength(1)
    expect(out.document.habitats[0]).toEqual(
      expect.objectContaining({
        ref: 'P1',
        type: LOWLAND_MEADOWS,
        broadType: 'Grassland',
        condition: 'Good',
        strategicSignificance: 'High',
        retentionCategory: 'Retain',
        properties: expect.objectContaining({ Area: 1.23 })
      })
    )
    expect(out.document.habitats[0]).not.toHaveProperty('area')
    expect(out.document.habitats[0]).not.toHaveProperty('sizeSquareMetres')
    expect(out.document.habitats[0]).not.toHaveProperty('distinctiveness')
    expect(out.document.habitats[0]).not.toHaveProperty('distinctivenessScore')
  })

  it('does not include geometry or srid in document features', () => {
    const out = extractBaseline({
      redline: [feature({ name: 'r' })],
      areas: [feature({ [PARCEL_REF]: 'P1' })],
      hedgerows: [feature({ [PARCEL_REF]: 'H1' }, SAMPLE_LINESTRING)],
      watercourses: [feature({ [PARCEL_REF]: 'W1' }, SAMPLE_LINESTRING)]
    })

    expect(out.document.redLine).not.toHaveProperty('geometry')
    expect(out.document.redLine).not.toHaveProperty('srid')
    expect(out.document.habitats[0]).not.toHaveProperty('geometry')
    expect(out.document.habitats[0]).not.toHaveProperty('srid')
    expect(out.document.hedgerows[0]).not.toHaveProperty('geometry')
    expect(out.document.watercourses[0]).not.toHaveProperty('geometry')
  })

  it('strips the "N. " list-index prefix from condition labels on area, hedgerow and watercourse features', () => {
    const out = extractBaseline({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          [HABITAT_TYPE]: LOWLAND_MEADOWS,
          [CONDITION]: '3. Moderate'
        })
      ],
      hedgerows: [
        feature(
          {
            [PARCEL_REF]: 'H1',
            [HEDGEROW_TYPE]: 'Native species-rich hedgerow',
            [CONDITION]: '5. Poor'
          },
          SAMPLE_LINESTRING
        )
      ],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'W1',
            [RIVER_TYPE]: 'Chalk stream',
            [CONDITION]: '6. N/A - Other'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.habitats[0].condition).toBe('Moderate')
    expect(out.document.hedgerows[0].condition).toBe('Poor')
    expect(out.document.watercourses[0].condition).toBe('N/A - Other')
  })

  it('preserves the raw GPKG row as `properties` so nothing is lost in extraction', () => {
    const row = {
      [PARCEL_REF]: 'P1',
      [HABITAT_TYPE]: 'Grassland - Modified grassland',
      ExtraField: 'something custom',
      fid: 42
    }

    const out = extractBaseline({
      redline: [],
      areas: [feature(row)],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].properties).toEqual(row)
  })
})

describe('extractBaseline — document property key fallbacks', () => {
  it('falls back to alternative property keys (underscored / lowercased)', () => {
    const out = extractBaseline({
      redline: [],
      areas: [
        feature({
          parcel_ref: 'P-alt',
          Baseline_Habitat_Type: LOWLAND_MEADOWS,
          Baseline_Condition: 'Moderate'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0]).toEqual(
      expect.objectContaining({
        ref: 'P-alt',
        type: LOWLAND_MEADOWS,
        condition: 'Moderate'
      })
    )
    expect(out.document.habitats[0]).not.toHaveProperty('distinctiveness')
    expect(out.document.habitats[0]).not.toHaveProperty('distinctivenessScore')
  })

  // Real QGIS-authored GeoPackages put the broad name in
  // "Baseline Broad Habitat Type" and the type alone in "Baseline Habitat Type".
  it('extracts separate broad and type columns for real GeoPackage shape', () => {
    const out = extractBaseline({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Baseline Broad Habitat Type': 'Grassland',
          [HABITAT_TYPE]: 'Lowland meadows'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0]).toEqual(
      expect.objectContaining({
        type: 'Lowland meadows',
        broadType: 'Grassland'
      })
    )
    expect(out.document.habitats[0]).not.toHaveProperty('distinctiveness')
    expect(out.document.habitats[0]).not.toHaveProperty('distinctivenessScore')
  })
})

describe('extractBaseline — document hedgerows, watercourses, and missing-field defaults', () => {
  it('extracts hedgerows and watercourses with ref, type and condition', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [
        feature(
          {
            [PARCEL_REF]: 'H1',
            [HEDGEROW_TYPE]: 'Native species-rich hedgerow',
            [CONDITION]: 'Good'
          },
          SAMPLE_LINESTRING
        )
      ],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'W1',
            [RIVER_TYPE]: 'Chalk stream',
            [CONDITION]: 'Moderate',
            'Baseline Encroachment into Watercourse': 'Minor',
            'Baseline Encroachment into riparian zone':
              '1. Minor/No Encroachment'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.hedgerows[0]).toEqual(
      expect.objectContaining({
        ref: 'H1',
        type: 'Native species-rich hedgerow',
        condition: 'Good'
      })
    )
    expect(out.document.watercourses[0]).toEqual(
      expect.objectContaining({
        ref: 'W1',
        type: 'Chalk stream',
        condition: 'Moderate',
        watercourseEncroachment: 'Minor',
        riparianEncroachment: '1. Minor/No Encroachment'
      })
    )
  })

  it('returns null for missing habitat fields rather than undefined', () => {
    const out = extractBaseline({
      redline: [],
      areas: [feature({})],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0]).toEqual(
      expect.objectContaining({
        ref: null,
        type: null,
        condition: null
      })
    )
    expect(out.document.habitats[0]).not.toHaveProperty('distinctiveness')
    expect(out.document.habitats[0]).not.toHaveProperty('distinctivenessScore')
  })
})

describe('extractBaseline — geometries half', () => {
  it('returns the red line as a single geometry row, taking the first when multiple are present', () => {
    const first = feature({ name: 'first' })
    const second = feature({ name: 'second' })

    const out = extractBaseline({
      redline: [first, second],
      areas: [],
      hedgerows: [],
      watercourses: []
    })

    expect(out.geometries.redLine).toEqual({
      featureId: out.document.redLine.featureId,
      geometry: SAMPLE_POLYGON,
      srid: BNG_SRID
    })
  })

  it('returns one geometry row per habitat with the parcel ref denormalised for PostGIS-only queries', () => {
    const out = extractBaseline({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          [HABITAT_TYPE]: LOWLAND_MEADOWS
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.geometries.habitats).toHaveLength(1)
    expect(out.geometries.habitats[0]).toEqual({
      featureId: out.document.habitats[0].featureId,
      ref: 'P1',
      geometry: SAMPLE_POLYGON,
      srid: BNG_SRID
    })
  })

  it('keeps the source SRID alongside each geometry so the persistence layer can ST_Transform', () => {
    const out = extractBaseline({
      redline: [],
      areas: [feature({ [PARCEL_REF]: 'P1' }, SAMPLE_POLYGON, WGS84_SRID)],
      hedgerows: [],
      watercourses: []
    })

    expect(out.geometries.habitats[0].srid).toBe(WGS84_SRID)
  })

  it('returns one geometry row per hedgerow and watercourse', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [feature({ [PARCEL_REF]: 'H1' }, SAMPLE_LINESTRING)],
      watercourses: [feature({ [PARCEL_REF]: 'W1' }, SAMPLE_LINESTRING)]
    })

    expect(out.geometries.hedgerows).toHaveLength(1)
    expect(out.geometries.hedgerows[0]).toEqual({
      featureId: out.document.hedgerows[0].featureId,
      ref: 'H1',
      geometry: SAMPLE_LINESTRING,
      srid: BNG_SRID
    })
    expect(out.geometries.watercourses).toHaveLength(1)
    expect(out.geometries.watercourses[0].ref).toBe('W1')
  })
})

describe('extractBaseline — graceful inputs', () => {
  it('handles missing layer arrays gracefully', () => {
    const out = extractBaseline({})

    expect(out.document.redLine).toBeNull()
    expect(out.document.habitats).toEqual([])
    expect(out.document.hedgerows).toEqual([])
    expect(out.document.watercourses).toEqual([])
    expect(out.geometries.redLine).toBeNull()
    expect(out.geometries.habitats).toEqual([])
    expect(out.geometries.hedgerows).toEqual([])
    expect(out.geometries.watercourses).toEqual([])
  })
})

describe('extractBaseline — habitat status', () => {
  it('sets area habitat status to Complete when broadType, type and condition are all present', () => {
    const out = extractBaseline({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Baseline Broad Habitat Type': 'Grassland',
          [HABITAT_TYPE]: 'Lowland meadows',
          [CONDITION]: 'Good'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].status).toBe('Complete')
  })

  it('sets area habitat status to Incomplete when any required field is missing', () => {
    const out = extractBaseline({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          [HABITAT_TYPE]: 'Lowland meadows'
          // condition and broadType absent
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].status).toBe('Incomplete')
  })

  it('sets hedgerow status to Complete when type and condition are both present', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [
        feature(
          {
            [PARCEL_REF]: 'H1',
            [HEDGEROW_TYPE]: 'Native species rich hedgerow',
            [CONDITION]: 'Good'
          },
          SAMPLE_LINESTRING
        )
      ],
      watercourses: []
    })

    expect(out.document.hedgerows[0].status).toBe('Complete')
  })

  it('sets hedgerow status to Incomplete when condition is missing', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [
        feature(
          {
            [PARCEL_REF]: 'H1',
            [HEDGEROW_TYPE]: 'Native species rich hedgerow'
          },
          SAMPLE_LINESTRING
        )
      ],
      watercourses: []
    })

    expect(out.document.hedgerows[0].status).toBe('Incomplete')
  })

  it('sets watercourse status to Complete when all four required fields are present', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'W1',
            [RIVER_TYPE]: 'Watercourse footprint - Watercourse footprint',
            [CONDITION]: 'Moderate',
            'Baseline Encroachment into riparian zone': 'None',
            'Baseline Encroachment into Watercourse': 'None'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.watercourses[0].status).toBe('Complete')
  })

  it('sets watercourse status to Incomplete when riparianEncroachment is missing', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'W1',
            [RIVER_TYPE]: 'Watercourse footprint - Watercourse footprint',
            [CONDITION]: 'Moderate',
            'Baseline Encroachment into Watercourse': 'None'
            // riparianEncroachment absent
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.watercourses[0].status).toBe('Incomplete')
  })

  it('sets watercourse status to Incomplete when watercourseEncroachment is missing', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'W1',
            [RIVER_TYPE]: 'Watercourse footprint - Watercourse footprint',
            [CONDITION]: 'Moderate',
            'Baseline Encroachment into riparian zone': 'None'
            // watercourseEncroachment absent
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.watercourses[0].status).toBe('Incomplete')
  })

  it('embeds riparianEncroachment and watercourseEncroachment on watercourse documents', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'W1',
            'Baseline Encroachment into riparian zone': 'Low',
            'Baseline Encroachment into Watercourse': 'High'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.watercourses[0].riparianEncroachment).toBe('Low')
    expect(out.document.watercourses[0].watercourseEncroachment).toBe('High')
    expect(out.document.watercourses[0]).not.toHaveProperty(
      'watercoursEncroachment'
    )
  })

  it('reads underscored watercourse encroachment columns', () => {
    const out = extractBaseline({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'W1',
            [RIVER_TYPE]: 'Watercourse footprint - Watercourse footprint',
            [CONDITION]: 'Moderate',
            Baseline_Encroachment_into_riparian_zone: 'Low',
            Baseline_Encroachment_into_Watercourse: 'High'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.watercourses[0]).toEqual(
      expect.objectContaining({
        riparianEncroachment: 'Low',
        watercourseEncroachment: 'High',
        status: 'Complete'
      })
    )
  })
})
