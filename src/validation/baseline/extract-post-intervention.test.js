import { describe, expect, it } from 'vitest'

import { extractPostIntervention } from './extract-post-intervention.js'
import { postInterventionDataSchema } from '../project.js'
import {
  PARCEL_REF,
  SAMPLE_LINESTRING,
  UPLOADED_FILE_SIZE,
  feature
} from './extract-post-intervention.test-fixtures.js'

describe('extractPostIntervention — top-level shape', () => {
  it('returns both a document and geometries half', () => {
    const out = extractPostIntervention({
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
  })

  it('threads uploadId, filename and fileSize from meta into the document', () => {
    const out = extractPostIntervention(
      { redline: [], areas: [], hedgerows: [], watercourses: [] },
      {
        uploadId: 'u-456',
        filename: 'post.gpkg',
        fileSize: UPLOADED_FILE_SIZE,
        importedAt: '2026-05-10T12:00:00.000Z'
      }
    )

    expect(out.document.uploadId).toBe('u-456')
    expect(out.document.filename).toBe('post.gpkg')
    expect(out.document.fileSize).toBe(UPLOADED_FILE_SIZE)
    expect(out.document.importedAt).toBe('2026-05-10T12:00:00.000Z')
  })

  it('extracts the first redline feature into document and geometries', () => {
    const out = extractPostIntervention({
      redline: [feature({ 'Parcel Ref': 'RL1', fid: 1 })],
      areas: [],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.redLine).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ fid: 1 })
      })
    )
    expect(out.geometries.redLine).toEqual(
      expect.objectContaining({
        geometry: expect.any(Object),
        srid: expect.any(Number)
      })
    )
  })
})

describe('extractPostIntervention — habitat nested structure', () => {
  it('produces a baseline sub-object with baseline GPKG column values', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'H1-1',
          'Baseline Habitat Type': 'Modified grassland',
          'Baseline Broad Habitat Type': 'Grassland',
          'Baseline Condition': '3. Moderate',
          'Baseline Strategic Significance': 'Low significance',
          'Retention Category': 'Lost'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    const hab = out.document.habitats[0]
    expect(hab.retentionCategory).toBe('Created')
    expect(hab.baseline).toEqual(
      expect.objectContaining({
        type: 'Modified grassland',
        broadType: 'Grassland',
        condition: 'Moderate',
        strategicSignificance: 'Low significance'
      })
    )
    expect(hab.baseline).not.toHaveProperty('retentionCategory')
    expect(hab.baseline.conditionScore).toBeNull()
    expect(hab.baseline.distinctiveness).toBeNull()
    expect(hab.baseline.distinctivenessScore).toBeNull()
  })

  it('produces a proposed sub-object with proposed GPKG column values', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'H1-1',
          'Proposed Habitat Type': 'Developed land; sealed surface',
          'Proposed Broad Habitat Type': 'Urban',
          'Proposed Condition': '6. N/A - Other',
          'Proposed Strategic Significance':
            'Area/compensation not in strategy',
          'Habitat created in advance/years': '2',
          'Delay in starting habitat creation/years': '1'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    const hab = out.document.habitats[0]
    expect(hab.proposed).toEqual(
      expect.objectContaining({
        type: 'Developed land; sealed surface',
        broadType: 'Urban',
        condition: 'N/A - Other',
        strategicSignificance: 'Area/compensation not in strategy',
        advanceYears: 2,
        delayYears: 1
      })
    )
    expect(hab.proposed.conditionScore).toBeNull()
    expect(hab.proposed.distinctiveness).toBeNull()
    expect(hab.proposed.distinctivenessScore).toBeNull()
  })

  it('does NOT have top-level type, broadType or condition fields', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'H1-1',
          'Baseline Habitat Type': 'Grassland',
          'Proposed Habitat Type': 'Urban'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    const hab = out.document.habitats[0]
    expect(hab).not.toHaveProperty('type')
    expect(hab).not.toHaveProperty('broadType')
    expect(hab).not.toHaveProperty('condition')
    expect(hab).not.toHaveProperty('strategicSignificance')
    expect(hab.baseline).not.toHaveProperty('retentionCategory')
  })

  it('strips the "N. " condition prefix on both baseline and proposed conditions', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Baseline Condition': '3. Moderate',
          'Proposed Condition': '6. N/A - Other'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].baseline.condition).toBe('Moderate')
    expect(out.document.habitats[0].proposed.condition).toBe('N/A - Other')
  })

  it('defaults advanceYears and delayYears to 0 when columns are absent', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [feature({ [PARCEL_REF]: 'P1' })],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].proposed.advanceYears).toBe(0)
    expect(out.document.habitats[0].proposed.delayYears).toBe(0)
  })

  it('preserves raw GPKG row as top-level properties', () => {
    const row = {
      [PARCEL_REF]: 'P1',
      'Baseline Habitat Type': 'Grassland',
      'Proposed Habitat Type': 'Urban',
      fid: 5
    }
    const out = extractPostIntervention({
      redline: [],
      areas: [feature(row)],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].properties).toEqual(row)
  })
})

describe('extractPostIntervention — Retained empty proposed copy', () => {
  it('copies baseline identity onto empty proposed for Retained habitats', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'H1',
          'Retention Category': 'Retained',
          'Baseline Habitat Type': 'Developed land; sealed surface',
          'Baseline Broad Habitat Type': 'Urban',
          'Baseline Condition': '6. N/A - Other',
          'Baseline Strategic Significance': 'Low significance',
          'Proposed Habitat Type': 'N/A',
          'Proposed Broad Habitat Type': 'N/A',
          'Proposed Condition': 'N/A',
          'Proposed Strategic Significance': 'N/A'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    const hab = out.document.habitats[0]
    expect(hab.retentionCategory).toBe('Retained')
    expect(hab.proposed).toEqual(
      expect.objectContaining({
        type: 'Developed land; sealed surface',
        broadType: 'Urban',
        condition: 'N/A - Other',
        strategicSignificance: 'Low significance'
      })
    )
    expect(hab.status).toBe('Complete')
  })

  it('does not overwrite a non-empty proposed side on Retained habitats', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'H1',
          'Retention Category': 'Retained',
          'Baseline Habitat Type': 'Modified grassland',
          'Baseline Broad Habitat Type': 'Grassland',
          'Baseline Condition': '3. Moderate',
          'Proposed Habitat Type': 'Other woodland; broadleaved',
          'Proposed Broad Habitat Type': 'Woodland and forest',
          'Proposed Condition': '2. Poor'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    const hab = out.document.habitats[0]
    expect(hab.proposed.type).toBe('Other woodland; broadleaved')
    expect(hab.proposed.broadType).toBe('Woodland and forest')
    expect(hab.proposed.condition).toBe('Poor')
  })

  it('does not copy baseline onto empty proposed when not Retained', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'H1',
          'Retention Category': 'Enhanced',
          'Baseline Habitat Type': 'Modified grassland',
          'Baseline Broad Habitat Type': 'Grassland',
          'Baseline Condition': '3. Moderate',
          'Proposed Habitat Type': 'N/A',
          'Proposed Broad Habitat Type': 'N/A',
          'Proposed Condition': 'N/A'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    const hab = out.document.habitats[0]
    expect(hab.proposed.type).toBe('N/A')
    expect(hab.proposed.condition).toBe('N/A')
    expect(hab.status).toBe('Incomplete')
  })

  it('copies baseline identity onto empty proposed for Retained hedgerows', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [
        feature(
          {
            [PARCEL_REF]: 'HW1',
            'Retention Category': 'Retained',
            'Baseline Hedge Type': 'Native hedgerow',
            'Baseline Condition': '2. Moderate',
            'Proposed Hedge Type': 'N/A',
            'Proposed Condition': 'N/A'
          },
          SAMPLE_LINESTRING
        )
      ],
      watercourses: []
    })

    const hedge = out.document.hedgerows[0]
    expect(hedge.proposed.type).toBe('Native hedgerow')
    expect(hedge.proposed.condition).toBe('Moderate')
    expect(hedge.status).toBe('Complete')
  })

  it('copies baseline identity onto empty proposed for Retained watercourses', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'WC1',
            'Retention Category': 'Retained',
            'Baseline River Type': 'Other rivers and streams',
            'Baseline Condition': '2. Moderate',
            'Baseline Encroachment into riparian zone':
              'No Encroachment/No Encroachment',
            'Baseline Encroachment into Watercourse': 'No Encroachment',
            'Proposed River Type': 'N/A',
            'Proposed Condition': 'N/A',
            'Proposed Encroachment into riparian zone': 'N/A',
            'Proposed Encroachment into Watercourse': 'N/A'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    const wc = out.document.watercourses[0]
    expect(wc.proposed).toEqual(
      expect.objectContaining({
        type: 'Other rivers and streams',
        condition: 'Moderate',
        riparianEncroachment: 'No Encroachment/No Encroachment',
        watercourseEncroachment: 'No Encroachment'
      })
    )
    expect(wc.status).toBe('Complete')
  })
})

describe('extractPostIntervention — habitat status', () => {
  it('is Complete when proposed broadType, type and condition are all present', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Proposed Broad Habitat Type': 'Grassland',
          'Proposed Habitat Type': 'Lowland meadows',
          'Proposed Condition': 'Good'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].status).toBe('Complete')
  })

  it('is Incomplete when proposed condition is N/A', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Proposed Broad Habitat Type': 'Grassland',
          'Proposed Habitat Type': 'Lowland meadows',
          'Proposed Condition': 'N/A'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].status).toBe('Incomplete')
  })

  it('is Incomplete when proposed type is missing', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [
        feature({
          [PARCEL_REF]: 'P1',
          'Proposed Broad Habitat Type': 'Grassland',
          'Proposed Condition': 'Good'
        })
      ],
      hedgerows: [],
      watercourses: []
    })

    expect(out.document.habitats[0].status).toBe('Incomplete')
  })
})

describe('extractPostIntervention — hedgerow nested structure', () => {
  it('produces baseline and proposed sub-objects for hedgerows', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [
        feature(
          {
            [PARCEL_REF]: 'HW1',
            'Baseline Hedge Type': 'Native species-rich hedgerow',
            'Baseline Condition': 'Good',
            'Proposed Hedge Type': 'Native hedge with trees - rare species',
            'Proposed Condition': 'Moderate',
            'Habitat created in advance/years': '0',
            'Delay in starting habitat creation/years': '0'
          },
          SAMPLE_LINESTRING
        )
      ],
      watercourses: []
    })

    const hedge = out.document.hedgerows[0]
    expect(hedge.baseline).toEqual(
      expect.objectContaining({
        type: 'Native species-rich hedgerow',
        condition: 'Good'
      })
    )
    expect(hedge.proposed).toEqual(
      expect.objectContaining({
        type: 'Native hedge with trees - rare species',
        condition: 'Moderate',
        advanceYears: 0,
        delayYears: 0
      })
    )
    expect(hedge).not.toHaveProperty('type')
    expect(hedge).not.toHaveProperty('condition')
  })

  it('excludes Lost hedgerows from the document and geometries', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [
        feature(
          {
            [PARCEL_REF]: 'H2',
            'Retention Category': 'Lost',
            'Baseline Hedge Type': 'Native hedgerow',
            'Baseline Condition': 'Good',
            'Proposed Hedge Type': 'N/A',
            'Proposed Condition': 'N/A',
            'Habitat created in advance/years': 'N/A',
            'Delay in starting habitat creation/years': 'N/A'
          },
          SAMPLE_LINESTRING
        )
      ],
      watercourses: []
    })

    expect(out.document.hedgerows).toEqual([])
    expect(out.geometries.hedgerows).toEqual([])
  })

  it('sets hedgerow status Complete when proposed type and condition present', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [
        feature(
          {
            [PARCEL_REF]: 'HW1',
            'Proposed Hedge Type': 'Native species-rich hedgerow',
            'Proposed Condition': 'Good'
          },
          SAMPLE_LINESTRING
        )
      ],
      watercourses: []
    })

    expect(out.document.hedgerows[0].status).toBe('Complete')
  })

  it('sets hedgerow status Incomplete when proposed condition is absent', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [
        feature(
          {
            [PARCEL_REF]: 'HW1',
            'Proposed Hedge Type': 'Native species-rich hedgerow'
          },
          SAMPLE_LINESTRING
        )
      ],
      watercourses: []
    })

    expect(out.document.hedgerows[0].status).toBe('Incomplete')
  })
})

describe('extractPostIntervention — watercourse nested structure', () => {
  it('places encroachments in both baseline and proposed sub-objects', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'WC1',
            'Baseline River Type': 'Chalk stream',
            'Baseline Condition': 'Good',
            'Baseline Encroachment into riparian zone': 'None',
            'Baseline Encroachment into Watercourse': 'None',
            'Baseline Strategic Significance': 'Low',
            'Proposed River Type': 'Modified watercourse',
            'Proposed Condition': 'Moderate',
            'Proposed Encroachment into riparian zone': 'Minor',
            'Proposed Encroachment into Watercourse': 'Minor',
            'Proposed Strategic Significance': 'Medium',
            'Habitat created in advance/years': '0',
            'Delay in starting habitat creation/years': '0'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    const wc = out.document.watercourses[0]
    expect(wc.baseline).toEqual(
      expect.objectContaining({
        type: 'Chalk stream',
        condition: 'Good',
        riparianEncroachment: 'None',
        watercourseEncroachment: 'None',
        strategicSignificance: 'Low'
      })
    )
    expect(wc.proposed).toEqual(
      expect.objectContaining({
        type: 'Modified watercourse',
        condition: 'Moderate',
        riparianEncroachment: 'Minor',
        watercourseEncroachment: 'Minor',
        strategicSignificance: 'Medium',
        advanceYears: 0,
        delayYears: 0
      })
    )
    expect(wc).not.toHaveProperty('type')
    expect(wc).not.toHaveProperty('condition')
    expect(wc).not.toHaveProperty('riparianEncroachment')
    expect(wc).not.toHaveProperty('watercourseEncroachment')
  })

  it('strips numeric prefix and normalises slash spacing in both baseline and proposed encroachment fields', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'WC2',
            'Baseline River Type': 'Other rivers and streams',
            'Baseline Condition': 'Moderate',
            // GeoPackage cells carry "N. " list-index prefixes
            'Baseline Encroachment into riparian zone': '1. Major/ Moderate',
            'Baseline Encroachment into Watercourse': '2. Major',
            'Proposed River Type': 'Other rivers and streams',
            'Proposed Condition': 'Good',
            'Proposed Encroachment into riparian zone':
              '1. Minor/No Encroachment',
            'Proposed Encroachment into Watercourse': '3. Minor',
            'Habitat created in advance/years': '0',
            'Delay in starting habitat creation/years': '0'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    const wc = out.document.watercourses[0]
    expect(wc.baseline).toEqual(
      expect.objectContaining({
        riparianEncroachment: 'Major/Moderate',
        watercourseEncroachment: 'Major'
      })
    )
    expect(wc.proposed).toEqual(
      expect.objectContaining({
        riparianEncroachment: 'Minor/No Encroachment',
        watercourseEncroachment: 'Minor'
      })
    )
  })

  it('sets watercourse status Complete when all proposed fields are present', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'WC1',
            'Proposed River Type': 'Chalk stream',
            'Proposed Condition': 'Good',
            'Proposed Encroachment into riparian zone': 'None',
            'Proposed Encroachment into Watercourse': 'None'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.watercourses[0].status).toBe('Complete')
  })

  it('sets watercourse status Incomplete when proposed encroachment is missing', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [
        feature(
          {
            [PARCEL_REF]: 'WC1',
            'Proposed River Type': 'Chalk stream',
            'Proposed Condition': 'Good'
          },
          SAMPLE_LINESTRING
        )
      ]
    })

    expect(out.document.watercourses[0].status).toBe('Incomplete')
  })
})

const SAMPLE_POINT = { type: 'Point', coordinates: [0, 0] }

// Per-size reference areas in m² (from bng-metric-engine individual-tree-area):
// Small 41, Medium 163, Large 366, Very large 765.
const SMALL_TREE_SQM = 41
const MEDIUM_TREE_SQM = 163

function treeFeature(properties) {
  return feature(properties, SAMPLE_POINT)
}

describe('extractPostIntervention — individual tree nested structure', () => {
  it('splits baseline and proposed tree columns into per-side sub-objects with their own area', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [],
      trees: [
        treeFeature({
          'Tree Ref': 'T1',
          'Baseline Tree Size': 'Small',
          'Baseline Tree Type': 'Oak',
          'Baseline Rural or Urban Tree': 'Urban',
          'Baseline Condition': '2. Moderate',
          'Proposed Tree Size': 'Medium',
          'Proposed Tree Type': 'Oak',
          'Proposed Rural or Urban Tree': 'Urban',
          'Proposed Condition': '2. Moderate',
          Count: 1
        })
      ]
    })

    const tree = out.document.trees[0]
    expect(tree.baseline).toEqual(
      expect.objectContaining({
        type: 'Urban tree',
        broadType: 'Individual trees',
        condition: 'Moderate',
        treeSize: 'Small',
        treeSpecies: 'Oak',
        ruralOrUrban: 'Urban',
        sizeSquareMetres: SMALL_TREE_SQM,
        area: SMALL_TREE_SQM
      })
    )
    expect(tree.proposed).toEqual(
      expect.objectContaining({
        type: 'Urban tree',
        broadType: 'Individual trees',
        treeSize: 'Medium',
        sizeSquareMetres: MEDIUM_TREE_SQM,
        area: MEDIUM_TREE_SQM,
        advanceYears: 0,
        delayYears: 0
      })
    )
    // Top-level area/size reflect the proposed side, like the area-habitat parcels.
    expect(tree.area).toBe(MEDIUM_TREE_SQM)
    expect(tree.sizeSquareMetres).toBe(MEDIUM_TREE_SQM)
    expect(tree.count).toBe(1)
    expect(tree).not.toHaveProperty('type')
    expect(tree).not.toHaveProperty('treeSize')
  })

  it('excludes Lost trees from the document and geometries', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [],
      trees: [
        treeFeature({
          'Tree Ref': 'T-lost',
          'Retention Category': 'Lost',
          'Baseline Tree Size': 'Small',
          'Baseline Rural or Urban Tree': 'Urban',
          'Baseline Condition': '2. Moderate',
          'Proposed Tree Size': 'N/A',
          'Proposed Rural or Urban Tree': 'N/A',
          'Proposed Condition': 'N/A',
          Count: 1
        }),
        treeFeature({
          'Tree Ref': 'T-kept',
          'Retention Category': 'Retained',
          'Baseline Tree Size': 'Small',
          'Baseline Rural or Urban Tree': 'Urban',
          'Baseline Condition': '2. Moderate',
          'Proposed Tree Size': 'Medium',
          'Proposed Rural or Urban Tree': 'Urban',
          'Proposed Condition': '2. Moderate',
          Count: 1
        })
      ]
    })

    expect(out.document.trees).toHaveLength(1)
    expect(out.document.trees[0].ref).toBe('T-kept')
    expect(out.geometries.trees).toHaveLength(1)
    expect(out.geometries.trees[0].ref).toBe('T-kept')
  })

  it('copies baseline onto empty proposed for Retained trees and syncs top-level area', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [],
      trees: [
        treeFeature({
          'Tree Ref': 'T1',
          'Retention Category': 'Retained',
          'Baseline Tree Size': 'Small',
          'Baseline Rural or Urban Tree': 'Urban',
          'Baseline Condition': '2. Moderate',
          'Proposed Tree Size': 'N/A',
          'Proposed Rural or Urban Tree': 'N/A',
          'Proposed Condition': 'N/A',
          Count: 1
        })
      ]
    })

    const tree = out.document.trees[0]
    expect(tree.proposed).toEqual(
      expect.objectContaining({
        type: 'Urban tree',
        broadType: 'Individual trees',
        condition: 'Moderate',
        treeSize: 'Small',
        ruralOrUrban: 'Urban',
        sizeSquareMetres: SMALL_TREE_SQM,
        area: SMALL_TREE_SQM
      })
    )
    expect(tree.area).toBe(SMALL_TREE_SQM)
    expect(tree.sizeSquareMetres).toBe(SMALL_TREE_SQM)
    expect(tree.status).toBe('Complete')
  })

  it('is Complete when the proposed side has broad type, type and condition', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [],
      trees: [
        treeFeature({
          'Tree Ref': 'T1',
          'Proposed Tree Size': 'Medium',
          'Proposed Rural or Urban Tree': 'Rural',
          'Proposed Condition': 'Moderate'
        })
      ]
    })

    expect(out.document.trees[0].status).toBe('Complete')
  })

  it('is Incomplete when the proposed rural/urban type is missing', () => {
    const out = extractPostIntervention({
      redline: [],
      areas: [],
      hedgerows: [],
      watercourses: [],
      trees: [
        treeFeature({
          'Tree Ref': 'T1',
          'Proposed Tree Size': 'Medium',
          'Proposed Condition': 'Moderate'
        })
      ]
    })

    expect(out.document.trees[0].status).toBe('Incomplete')
  })

  it('sums tree areas into areaHabitats and the urban/rural split, excluding them from site', () => {
    const PARCEL_TOTAL_SQM = 5000
    const habitatSizes = {
      areaHabitats: {
        totalSquareMetres: PARCEL_TOTAL_SQM,
        individualSquareMetres: []
      },
      hedgerows: { totalMetres: 0, individualMetres: [] },
      watercourses: { totalMetres: 0, individualMetres: [] }
    }
    const out = extractPostIntervention(
      {
        redline: [],
        areas: [],
        hedgerows: [],
        watercourses: [],
        trees: [
          treeFeature({
            'Tree Ref': 'T-urban',
            'Proposed Tree Size': 'Medium',
            'Proposed Rural or Urban Tree': 'Urban',
            'Proposed Condition': 'Moderate'
          }),
          treeFeature({
            'Tree Ref': 'T-rural',
            'Proposed Tree Size': 'Small',
            'Proposed Rural or Urban Tree': 'Rural',
            'Proposed Condition': 'Moderate'
          })
        ]
      },
      { habitatSizes }
    )

    expect(out.document.habitatSizes.trees).toEqual({
      totalSquareMetres: MEDIUM_TREE_SQM + SMALL_TREE_SQM,
      urbanSquareMetres: MEDIUM_TREE_SQM,
      ruralSquareMetres: SMALL_TREE_SQM
    })
    expect(out.document.habitatSizes.areaHabitats.totalSquareMetres).toBe(
      PARCEL_TOTAL_SQM + MEDIUM_TREE_SQM + SMALL_TREE_SQM
    )
    expect(out.document.habitatSizes.site.totalSquareMetres).toBe(
      PARCEL_TOTAL_SQM
    )
  })

  it('produces trees that satisfy the post-intervention schema', () => {
    const out = extractPostIntervention(
      {
        redline: [],
        areas: [],
        hedgerows: [],
        watercourses: [],
        trees: [
          treeFeature({
            'Tree Ref': 'T1',
            'Retention Category': 'Retained',
            'Baseline Tree Size': 'Large',
            'Baseline Rural or Urban Tree': 'Rural',
            'Baseline Condition': 'Moderate',
            'Proposed Tree Size': 'Large',
            'Proposed Rural or Urban Tree': 'Rural',
            'Proposed Condition': 'Moderate'
          })
        ]
      },
      {
        habitatSizes: {
          areaHabitats: { totalSquareMetres: 0, individualSquareMetres: [] },
          hedgerows: { totalMetres: 0, individualMetres: [] },
          watercourses: { totalMetres: 0, individualMetres: [] }
        }
      }
    )

    const { error } = postInterventionDataSchema.validate({
      importedAt: '2026-01-01T00:00:00.000Z',
      habitats: [],
      hedgerows: [],
      watercourses: [],
      trees: out.document.trees,
      habitatSizes: out.document.habitatSizes
    })
    expect(error).toBeUndefined()
  })
})
