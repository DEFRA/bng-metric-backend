import { describe, expect, it } from 'vitest'

import { extractHabitatData } from './extract-habitat-data.js'

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

describe('extractHabitatData — top-level shape', () => {
  it('returns both a document and geometries half', () => {
    const out = extractHabitatData({
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
          trees: [],
          habitatSizes: null
        }),
        geometries: {
          redLine: null,
          habitats: [],
          hedgerows: [],
          watercourses: [],
          trees: []
        }
      })
    )
    expect(() => new Date(out.document.importedAt).toISOString()).not.toThrow()
  })

  it('threads uploadId and importedAt from meta into the document half only', () => {
    const out = extractHabitatData(
      { redline: [], areas: [], hedgerows: [], watercourses: [] },
      { uploadId: 'u-123', importedAt: '2026-05-08T10:00:00.000Z' }
    )

    expect(out.document.uploadId).toBe('u-123')
    expect(out.document.importedAt).toBe('2026-05-08T10:00:00.000Z')
    expect(out.geometries).not.toHaveProperty('uploadId')
  })

  it('threads filename and fileSize from meta into the document', () => {
    const out = extractHabitatData(
      { redline: [], areas: [], hedgerows: [], watercourses: [] },
      { filename: 'survey.gpkg', fileSize: UPLOADED_FILE_SIZE }
    )

    expect(out.document.filename).toBe('survey.gpkg')
    expect(out.document.fileSize).toBe(UPLOADED_FILE_SIZE)
    expect(out.geometries).not.toHaveProperty('filename')
    expect(out.geometries).not.toHaveProperty('fileSize')
  })

  it('sets filename and fileSize to null when absent from meta', () => {
    const out = extractHabitatData({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.filename).toBeNull()
    expect(out.document.fileSize).toBeNull()
  })
})

const SAMPLE_POINT = { type: 'Point', coordinates: [0, 0] }

describe('extractHabitatData — individual trees', () => {
  function treeFeature(properties) {
    return feature(properties, SAMPLE_POINT)
  }

  it('builds tree documents with habitat type, broad type and per-size area', () => {
    const out = extractHabitatData({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [],
      trees: [
        treeFeature({
          'Tree Ref': 'T001',
          'Baseline Tree Size': 'Medium',
          'Baseline Tree Type': 'Street tree',
          'Baseline Condition': 'Good',
          'Baseline Rural or Urban Tree': 'Urban',
          Count: 1
        })
      ]
    })

    expect(out.document.trees).toHaveLength(1)
    const tree = out.document.trees[0]
    expect(tree.ref).toBe('T001')
    expect(tree.type).toBe('Urban tree')
    expect(tree.broadType).toBe('Individual trees')
    expect(tree.treeSize).toBe('Medium')
    expect(tree.treeSpecies).toBe('Street tree')
    expect(tree.ruralOrUrban).toBe('Urban')
    // 0.0163 ha → 163 m²
    expect(tree.sizeSquareMetres).toBe(163)
    expect(tree.area).toBe(163)
    expect(tree.status).toBe('Complete')
    expect(tree.featureId).toMatch(UUID_REGEX)
  })

  it('leaves area null and status Incomplete for an unrecognised tree size', () => {
    const out = extractHabitatData({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [],
      trees: [
        treeFeature({
          'Tree Ref': 'T002',
          'Baseline Tree Size': 'Enormous',
          'Baseline Rural or Urban Tree': 'Rural',
          'Baseline Condition': 'Moderate'
        })
      ]
    })

    const tree = out.document.trees[0]
    expect(tree.type).toBe('Rural tree')
    expect(tree.sizeSquareMetres).toBeNull()
    expect(tree.area).toBeNull()
  })

  it('produces a parallel tree geometry row carrying native geometry and srid', () => {
    const out = extractHabitatData({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [],
      trees: [
        treeFeature({ 'Tree Ref': 'T003', 'Baseline Tree Size': 'Small' })
      ]
    })

    expect(out.geometries.trees).toHaveLength(1)
    expect(out.geometries.trees[0]).toMatchObject({
      ref: 'T003',
      geometry: SAMPLE_POINT,
      srid: BNG_SRID
    })
    expect(out.geometries.trees[0].featureId).toBe(
      out.document.trees[0].featureId
    )
  })

  it('summarises tree sizes overall and by urban/rural and rolls into the total area size', () => {
    const habitatSizes = {
      areaHabitats: { individualSquareMetres: [], totalSquareMetres: 10_000 },
      hedgerows: { individualMetres: [], totalMetres: 0 },
      watercourses: { individualMetres: [], totalMetres: 0 }
    }
    const out = extractHabitatData(
      {
        redline: [],
        areas: [],
        hedgerows: [],
        watercourses: [],
        trees: [
          treeFeature({
            'Baseline Tree Size': 'Medium',
            'Baseline Rural or Urban Tree': 'Urban'
          }),
          treeFeature({
            'Baseline Tree Size': 'Small',
            'Baseline Rural or Urban Tree': 'Rural'
          })
        ]
      },
      { habitatSizes }
    )

    // Medium 163 m² + Small 41 m²
    expect(out.document.habitatSizes.trees).toEqual({
      totalSquareMetres: 204,
      urbanSquareMetres: 163,
      ruralSquareMetres: 41
    })
    // Total area size = parcels (10000) + trees (204); Site stays parcels-only
    // (excludes special tree habitats).
    expect(out.document.habitatSizes.areaHabitats.totalSquareMetres).toBe(
      10_204
    )
    expect(out.document.habitatSizes.site.totalSquareMetres).toBe(10_000)
  })
})

describe('extractHabitatData — habitatSizes embedding', () => {
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
    const out = extractHabitatData(
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
      watercourses: { totalMetres: 0 },
      trees: {
        totalSquareMetres: 0,
        urbanSquareMetres: 0,
        ruralSquareMetres: 0
      },
      site: { totalSquareMetres: HABITAT_SQM }
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
    const out = extractHabitatData(
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
    const out = extractHabitatData(
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
    const out = extractHabitatData(
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
    const out = extractHabitatData({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: []
    })
    expect(out.document.habitatSizes).toBeNull()
  })
})

describe('extractHabitatData — featureId join keys', () => {
  it('assigns a UUID featureId to every feature, matched between document and geometry halves', () => {
    const out = extractHabitatData({
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
    const out = extractHabitatData({
      redline: [],
      areas: [feature({ [PARCEL_REF]: 'P1' }), feature({ [PARCEL_REF]: 'P2' })],
      hedgerows: [],
      watercourses: []
    })

    const [a, b] = out.document.habitats
    expect(a.featureId).not.toBe(b.featureId)
  })
})

describe('extractHabitatData — habitat document fields and shape', () => {
  it('extracts habitat fields per parcel: ref, type, condition, plus retention/strategic significance', () => {
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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

    const out = extractHabitatData({
      redline: [],
      areas: [feature(row)],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].properties).toEqual(row)
  })
})

describe('extractHabitatData — document property key fallbacks', () => {
  it('falls back to alternative property keys (underscored / lowercased)', () => {
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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

describe('extractHabitatData — document hedgerows, watercourses, and missing-field defaults', () => {
  it('extracts hedgerows and watercourses with ref, type and condition', () => {
    const out = extractHabitatData({
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
        riparianEncroachment: 'Minor/No Encroachment'
      })
    )
  })

  it('strips numeric prefix and normalises slash spacing in watercourse encroachment fields', () => {
    const out = extractHabitatData({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'W2',
            [RIVER_TYPE]: 'Other rivers and streams',
            [CONDITION]: 'Moderate',
            // GeoPackage riparian values carry "N. " list-index prefixes and a
            // trailing space before "/" that must be normalised to canonical form
            'Baseline Encroachment into Watercourse': 'Major',
            'Baseline Encroachment into riparian zone': '1. Major/ Moderate'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.watercourses[0]).toEqual(
      expect.objectContaining({
        watercourseEncroachment: 'Major',
        riparianEncroachment: 'Major/Moderate'
      })
    )
  })

  it('returns null for missing habitat fields rather than undefined', () => {
    const out = extractHabitatData({
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

describe('extractHabitatData — geometries half', () => {
  it('returns the red line as a single geometry row, taking the first when multiple are present', () => {
    const first = feature({ name: 'first' })
    const second = feature({ name: 'second' })

    const out = extractHabitatData({
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
    const out = extractHabitatData({
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
    const out = extractHabitatData({
      redline: [],
      areas: [feature({ [PARCEL_REF]: 'P1' }, SAMPLE_POLYGON, WGS84_SRID)],
      hedgerows: [],
      watercourses: []
    })

    expect(out.geometries.habitats[0].srid).toBe(WGS84_SRID)
  })

  it('returns one geometry row per hedgerow and watercourse', () => {
    const out = extractHabitatData({
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

describe('extractHabitatData — graceful inputs', () => {
  it('handles missing layer arrays gracefully', () => {
    const out = extractHabitatData({})

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

describe('extractHabitatData — habitat status', () => {
  it('sets area habitat status to Complete when broadType, type and condition are all present', () => {
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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
    const out = extractHabitatData({
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

describe('extractHabitatData — promoted survey/provenance metadata (BMD-498)', () => {
  const METADATA_ROW = {
    'Site Name': 'Meadow Farm',
    'Survey Date': '2026-01-15',
    'Survey Details': 'Walkover survey',
    'Mapped by': 'A. Surveyor',
    Company: 'Ecology Ltd',
    'Base Map': 'OS MasterMap',
    Location: 'Field 3',
    'Spatial risk category': 'Low',
    'Habitat created in advance/years': '2',
    'Delay in starting habitat creation/years': '1',
    'Baseline Distinctiveness': 'Medium'
  }

  const EXPECTED_METADATA = {
    siteName: 'Meadow Farm',
    surveyDate: '2026-01-15',
    surveyDetails: 'Walkover survey',
    mappedBy: 'A. Surveyor',
    company: 'Ecology Ltd',
    baseMap: 'OS MasterMap',
    location: 'Field 3',
    spatialRiskCategory: 'Low',
    habitatCreatedInAdvanceYears: '2',
    delayInStartingHabitatCreationYears: '1',
    rawDistinctiveness: 'Medium'
  }

  it('promotes metadata onto area habitats (Comment column)', () => {
    const out = extractHabitatData({
      redline: [],
      areas: [
        feature({ [PARCEL_REF]: 'P1', ...METADATA_ROW, Comment: 'Note' })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0]).toEqual(
      expect.objectContaining({ ...EXPECTED_METADATA, comment: 'Note' })
    )
  })

  it('promotes metadata plus strategic significance and retention onto hedgerows (Comments column)', () => {
    const out = extractHabitatData({
      redline: [],
      areas: [],
      hedgerows: [
        feature(
          {
            [PARCEL_REF]: 'H1',
            'Baseline Strategic Significance': 'High',
            'Retention Category': 'Retained',
            Comments: 'Hedge note',
            ...METADATA_ROW
          },
          SAMPLE_LINESTRING
        )
      ],
      watercourses: []
    })

    expect(out.document.hedgerows[0]).toEqual(
      expect.objectContaining({
        ...EXPECTED_METADATA,
        comment: 'Hedge note',
        strategicSignificance: 'High',
        retentionCategory: 'Retained'
      })
    )
  })

  it('promotes metadata, strategic significance, retention and enhancement type onto watercourses', () => {
    const out = extractHabitatData({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'W1',
            'Baseline Strategic Significance': 'High',
            'Retention Category': 'Retained',
            'Enhancement Type': 'Re-meandering',
            Comments: 'River note',
            ...METADATA_ROW
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.watercourses[0]).toEqual(
      expect.objectContaining({
        ...EXPECTED_METADATA,
        comment: 'River note',
        strategicSignificance: 'High',
        retentionCategory: 'Retained',
        enhancementType: 'Re-meandering'
      })
    )
  })

  it('promotes siteName and area onto the red line, leaving them null when absent', () => {
    const withValues = extractHabitatData({
      redline: [feature({ 'Site Name': 'Meadow Farm', Area: 12345 })],
      areas: [],
      hedgerows: [],
      watercourses: []
    })
    expect(withValues.document.redLine).toEqual(
      expect.objectContaining({ siteName: 'Meadow Farm', area: 12345 })
    )

    const withoutValues = extractHabitatData({
      redline: [feature({ name: 'r' })],
      areas: [],
      hedgerows: [],
      watercourses: []
    })
    expect(withoutValues.document.redLine).toEqual(
      expect.objectContaining({ siteName: null, area: null })
    )
  })

  it('defaults promoted metadata to null when the columns are absent', () => {
    const out = extractHabitatData({
      redline: [],
      areas: [feature({ [PARCEL_REF]: 'P1' })],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0]).toEqual(
      expect.objectContaining({
        siteName: null,
        surveyDate: null,
        comment: null,
        rawDistinctiveness: null
      })
    )
  })
})

describe('extractHabitatData — post-intervention reads Proposed columns (variant)', () => {
  const POST = { variant: 'postIntervention' }

  it('reads Proposed* habitat columns and ignores the Baseline* columns', () => {
    const out = extractHabitatData(
      {
        redline: [],
        areas: [
          feature({
            [PARCEL_REF]: 'P1',
            // Baseline columns present but should be ignored for this variant.
            'Baseline Broad Habitat Type': 'Grassland',
            [HABITAT_TYPE]: 'Lowland meadows',
            [CONDITION]: 'Poor',
            'Baseline Strategic Significance': 'Low',
            'Baseline Distinctiveness': 'Low',
            // Proposed columns are the source of truth here.
            'Proposed Broad Habitat Type': 'Woodland and forest',
            'Proposed Habitat Type': 'Other woodland; broadleaved',
            'Proposed Condition': 'Good',
            'Proposed Strategic Significance': 'High',
            'Proposed Distinctiveness': 'Medium',
            // Retention is a single shared column (no proposed variant).
            'Retention Category': 'Created'
          })
        ],
        hedgerows: [],
        watercourses: []
      },
      POST
    )

    expect(out.document.habitats[0]).toEqual(
      expect.objectContaining({
        broadType: 'Woodland and forest',
        type: 'Other woodland; broadleaved',
        condition: 'Good',
        strategicSignificance: 'High',
        rawDistinctiveness: 'Medium',
        retentionCategory: 'Created'
      })
    )
  })

  it('reads Proposed Hedge Type / Condition / Strategic Significance for hedgerows', () => {
    const out = extractHabitatData(
      {
        redline: [],
        areas: [],
        hedgerows: [
          feature(
            {
              [PARCEL_REF]: 'H1',
              [HEDGEROW_TYPE]: 'Native hedgerow',
              [CONDITION]: 'Poor',
              'Proposed Hedge Type': 'Native hedgerow with trees',
              'Proposed Condition': 'Good',
              'Proposed Strategic Significance': 'High'
            },
            SAMPLE_LINESTRING
          )
        ],
        watercourses: []
      },
      POST
    )

    expect(out.document.hedgerows[0]).toEqual(
      expect.objectContaining({
        type: 'Native hedgerow with trees',
        condition: 'Good',
        strategicSignificance: 'High',
        status: 'Complete'
      })
    )
  })

  it('reads Proposed river type, condition and encroachment columns for watercourses', () => {
    const out = extractHabitatData(
      {
        redline: [],
        areas: [],
        hedgerows: [],
        watercourses: [
          feature(
            {
              [PARCEL_REF]: 'W1',
              [RIVER_TYPE]: 'Ditches',
              [CONDITION]: 'Poor',
              'Baseline Encroachment into Watercourse': 'High',
              'Baseline Encroachment into riparian zone': 'High',
              'Proposed River Type': 'Rivers and streams',
              'Proposed Condition': 'Good',
              'Proposed Strategic Significance': 'High',
              'Proposed Encroachment into Watercourse': 'No Encroachment',
              'Proposed Encroachment into riparian zone': 'No Encroachment'
            },
            SAMPLE_LINESTRING
          )
        ]
      },
      POST
    )

    expect(out.document.watercourses[0]).toEqual(
      expect.objectContaining({
        type: 'Rivers and streams',
        condition: 'Good',
        strategicSignificance: 'High',
        watercourseEncroachment: 'No Encroachment',
        riparianEncroachment: 'No Encroachment',
        status: 'Complete'
      })
    )
  })

  it('still reads Baseline* columns for the default (baseline) variant', () => {
    const layers = {
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Baseline Broad Habitat Type': 'Grassland',
          [HABITAT_TYPE]: 'Lowland meadows',
          [CONDITION]: 'Good',
          'Proposed Broad Habitat Type': 'Woodland and forest',
          'Proposed Habitat Type': 'Other woodland; broadleaved',
          'Proposed Condition': 'Poor'
        })
      ],
      hedgerows: [],
      watercourses: []
    }

    expect(extractHabitatData(layers).document.habitats[0]).toEqual(
      expect.objectContaining({
        broadType: 'Grassland',
        type: 'Lowland meadows',
        condition: 'Good'
      })
    )
  })
})
