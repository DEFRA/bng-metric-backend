import { describe, test, expect } from 'vitest'
import {
  habitatDataSchema,
  projectSchema,
  siteSchema,
  unitsSchema,
  postInterventionDataSchema
} from './project.js'
import { MAX_FILE_SIZE_BYTES } from '../services/s3/download-file.js'

describe('#siteSchema', () => {
  test('Should validate a valid site object', () => {
    const { error } = siteSchema.validate({
      name: 'Greenfield Meadow',
      grid_ref: 'TQ 123 456'
    })
    expect(error).toBeUndefined()
  })

  test('Should reject invalid site field types', () => {
    const { error } = siteSchema.validate({ name: 123 })
    expect(error).toBeDefined()
  })
})

describe('#unitsSchema', () => {
  test('Should validate a valid units object', () => {
    const { error } = unitsSchema.validate({
      habitat: 10.5,
      hedgerow: 2.3,
      watercourse: 0.8
    })
    expect(error).toBeUndefined()
  })

  test('Should reject invalid units field types', () => {
    const { error } = unitsSchema.validate({ habitat: 'not-a-number' })
    expect(error).toBeDefined()
  })
})

describe('#projectSchema', () => {
  test('Should validate a full project object', () => {
    const { error } = projectSchema.validate({
      name: 'Greenfield Meadow Restoration',
      site: { name: 'Greenfield Meadow', grid_ref: 'TQ 123 456' },
      units: { habitat: 10.5, hedgerow: 2.3, watercourse: 0.8 }
    })
    expect(error).toBeUndefined()
  })

  test('Should allow partial project object', () => {
    const { error } = projectSchema.validate({ name: 'Minimal Project' })
    expect(error).toBeUndefined()
  })

  test('Should reject invalid nested types', () => {
    const { error } = projectSchema.validate({
      name: 'Test',
      units: { habitat: 'bad' }
    })
    expect(error).toBeDefined()
  })

  test('Should allow baseline habitat rows with metric units', () => {
    const { error } = habitatDataSchema.validate({
      importedAt: '2026-01-01T00:00:00.000Z',
      redLine: null,
      habitats: [
        {
          featureId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          type: 'Grassland - Modified grassland',
          condition: 'Moderate',
          area: 100,
          sizeSquareMetres: 100.4,
          distinctiveness: 'Low',
          distinctivenessScore: 2,
          status: 'Complete',
          units: 0.04
        }
      ],
      hedgerows: [],
      watercourses: [],
      units: {
        totalUnits: 0.04,
        habitatsTotal: 0.04,
        hedgerowsTotal: 0,
        watercoursesTotal: 0,
        treesTotal: 0,
        treesUrbanTotal: 0,
        treesRuralTotal: 0
      }
    })
    expect(error).toBeUndefined()
  })

  test('Should allow baseline individual tree rows, tree size totals and site size', () => {
    const { error } = habitatDataSchema.validate({
      importedAt: '2026-01-01T00:00:00.000Z',
      redLine: null,
      habitats: [],
      trees: [
        {
          featureId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          ref: 'T001',
          type: 'Urban tree',
          broadType: 'Individual trees',
          treeSize: 'Medium',
          treeSpecies: 'Street tree',
          ruralOrUrban: 'Urban',
          count: 1,
          condition: 'Good',
          distinctiveness: 'Medium',
          distinctivenessScore: 4,
          conditionScore: 3,
          area: 163,
          sizeSquareMetres: 163,
          status: 'Complete',
          units: 0.1956
        }
      ],
      hedgerows: [],
      watercourses: [],
      habitatSizes: {
        // Total area size = parcels (10000) + trees (163); Site = parcels only.
        areaHabitats: { totalSquareMetres: 10163 },
        hedgerows: { totalMetres: 0 },
        watercourses: { totalMetres: 0 },
        trees: {
          totalSquareMetres: 163,
          urbanSquareMetres: 163,
          ruralSquareMetres: 0
        },
        site: { totalSquareMetres: 10000 }
      },
      units: {
        totalUnits: 0.1956,
        habitatsTotal: 0,
        hedgerowsTotal: 0,
        watercoursesTotal: 0,
        treesTotal: 0.1956,
        treesUrbanTotal: 0.1956,
        treesRuralTotal: 0
      }
    })
    expect(error).toBeUndefined()
  })

  test('Should allow redLine with siteName and area from the GeoPackage', () => {
    const { error } = habitatDataSchema.validate({
      importedAt: '2026-01-01T00:00:00.000Z',
      redLine: {
        featureId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        siteName: 'Meadow Farm',
        area: 12345,
        properties: {}
      },
      habitats: [],
      hedgerows: [],
      watercourses: []
    })
    expect(error).toBeUndefined()
  })

  test('Should allow redLine siteName as empty string and null area', () => {
    const { error } = habitatDataSchema.validate({
      importedAt: '2026-01-01T00:00:00.000Z',
      redLine: {
        featureId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        siteName: '',
        area: null,
        properties: {}
      },
      habitats: [],
      hedgerows: [],
      watercourses: []
    })
    expect(error).toBeUndefined()
  })

  test('Should reject baseline units totals with missing fields', () => {
    const { error } = habitatDataSchema.validate({
      importedAt: '2026-01-01T00:00:00.000Z',
      redLine: null,
      habitats: [],
      hedgerows: [],
      watercourses: [],
      units: { totalUnits: 1, habitatsTotal: 1 }
    })
    expect(error).toBeDefined()
  })

  test('Should allow post-intervention units with net unit change fields', () => {
    const { error } = postInterventionDataSchema.validate({
      importedAt: '2026-01-01T00:00:00.000Z',
      habitats: [],
      hedgerows: [],
      watercourses: [],
      units: {
        totalUnits: 12,
        habitatsTotal: 8,
        hedgerowsTotal: 3,
        watercoursesTotal: 1,
        treesTotal: 0,
        treesUrbanTotal: 0,
        treesRuralTotal: 0,
        habitatsNetUnitChange: 2,
        habitatsNetUnitChangePercentage: 33.33333333333333,
        hedgerowsNetUnitChange: -1,
        hedgerowsNetUnitChangePercentage: -25,
        watercoursesNetUnitChange: 0,
        watercoursesNetUnitChangePercentage: null
      }
    })

    expect(error).toBeUndefined()
  })

  test('Should reject baseline filename longer than 255 characters', () => {
    const { error } = projectSchema.validate({
      baseline: {
        uploadId: null,
        filename: `${'a'.repeat(256)}.gpkg`,
        fileSize: 1024
      }
    })
    expect(error).toBeDefined()
    expect(error.details[0].path).toEqual(['baseline', 'filename'])
  })

  test('Should reject baseline file size over the 100 MB limit', () => {
    const { error } = projectSchema.validate({
      baseline: {
        uploadId: null,
        filename: 'survey.gpkg',
        fileSize: MAX_FILE_SIZE_BYTES + 1
      }
    })
    expect(error).toBeDefined()
    expect(error.details[0].path).toEqual(['baseline', 'fileSize'])
  })
})

describe('#filename validation', () => {
  const withFilename = (filename) => habitatDataSchema.validate({ filename })

  test('Should accept a clean .gpkg filename', () => {
    const { error } = withFilename('survey.gpkg')
    expect(error).toBeUndefined()
  })

  test('Should accept filenames with dots, hyphens, underscores and spaces', () => {
    const { error } = withFilename('my survey_v2.0-final.gpkg')
    expect(error).toBeUndefined()
  })

  test('Should accept null filename', () => {
    const { error } = withFilename(null)
    expect(error).toBeUndefined()
  })

  test('Should reject wrong extension (extension spoofing via legitimate name)', () => {
    // survey.exe has no .gpkg extension — must be rejected
    const { error } = withFilename('survey.exe')
    expect(error).toBeDefined()
  })

  test('Should reject RTL override character (extension spoofing)', () => {
    // U+202E flips rendering so survey\u202Egpkg.exe displays as survey.exe.gpkg
    const { error } = withFilename('survey\u202Egpkg.exe')
    expect(error).toBeDefined()
  })

  test('Should reject path traversal sequences', () => {
    const { error } = withFilename('../../../etc/passwd.gpkg')
    expect(error).toBeDefined()
  })

  test('Should reject newline (log injection)', () => {
    const { error } = withFilename('survey\n.gpkg')
    expect(error).toBeDefined()
  })

  test('Should reject zero-width space (invisible-char duplicate)', () => {
    // sur\u200Bvey.gpkg renders identically to survey.gpkg but is a different string
    const { error } = withFilename('sur\u200Bvey.gpkg')
    expect(error).toBeDefined()
  })

  test('Should reject SQL injection characters', () => {
    const { error } = withFilename("survey'; DROP TABLE projects; --.gpkg")
    expect(error).toBeDefined()
  })
})

describe('#habitatDataSchema', () => {
  const validBaseline = {
    uploadId: 'f6b667d8-998f-4f55-8a20-204c0c289147',
    importedAt: '2026-05-08T00:00:00.000Z',
    redLine: null,
    habitats: [
      {
        featureId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        ref: 'P1',
        type: 'Lowland meadows',
        broadType: 'Grassland',
        condition: 'Good',
        sizeSquareMetres: 10,
        status: 'Complete',
        properties: {}
      }
    ],
    hedgerows: [
      {
        featureId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        type: 'Native species rich hedgerow',
        condition: 'Good',
        sizeMetres: 20,
        status: 'Complete',
        properties: {}
      }
    ],
    watercourses: [
      {
        featureId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        type: 'Watercourse footprint - Watercourse footprint',
        condition: 'Moderate',
        riparianEncroachment: 'None',
        watercourseEncroachment: 'None',
        sizeMetres: 30,
        status: 'Complete',
        properties: {}
      }
    ],
    habitatSizes: {
      areaHabitats: { totalSquareMetres: 10 },
      hedgerows: { totalMetres: 20 },
      watercourses: { totalMetres: 30 }
    }
  }

  test('Should validate persisted baseline status and size fields', () => {
    const { error } = habitatDataSchema.validate(validBaseline)
    expect(error).toBeUndefined()
  })

  test('Should require status on persisted habitat documents', () => {
    const baseline = structuredClone(validBaseline)
    delete baseline.habitats[0].status

    const { error } = habitatDataSchema.validate(baseline)
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"habitats\[0\]\.status" is required/)
  })

  test('Should reject invalid persisted status values', () => {
    const baseline = structuredClone(validBaseline)
    baseline.watercourses[0].status = 'Done'

    const { error } = habitatDataSchema.validate(baseline)
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"watercourses\[0\]\.status" must be one of/)
  })

  test('Should reject the legacy misspelled watercoursEncroachment field', () => {
    const baseline = structuredClone(validBaseline)
    baseline.watercourses[0].watercoursEncroachment = 'None'
    delete baseline.watercourses[0].watercourseEncroachment

    const { error } = habitatDataSchema.validate(baseline)
    expect(error).toBeDefined()
    expect(error.message).toMatch(
      /"watercourses\[0\]\.watercoursEncroachment" is not allowed/
    )
  })
})

describe('#postInterventionDataSchema', () => {
  const validPostIntervention = {
    uploadId: 'e1a22345-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    importedAt: '2026-05-08T00:00:00.000Z',
    redLine: null,
    habitats: [
      {
        featureId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        ref: 'H2-1',
        area: 7850,
        sizeSquareMetres: 7850.14,
        units: 3.14,
        status: 'Complete',
        baseline: {
          type: 'Modified grassland',
          broadType: 'Grassland',
          condition: 'Moderate',
          conditionScore: 2,
          distinctiveness: 'Low',
          distinctivenessScore: 2,
          strategicSignificance: 'Low',
          retentionCategory: 'Lost'
        },
        proposed: {
          type: 'Developed land; sealed surface',
          broadType: 'Urban',
          condition: 'N/A - Other',
          conditionScore: null,
          distinctiveness: 'Low',
          distinctivenessScore: 2,
          strategicSignificance: 'Low',
          advanceYears: 0,
          delayYears: 0
        },
        properties: {}
      }
    ],
    hedgerows: [],
    watercourses: []
  }

  test('Should validate a valid post-intervention document', () => {
    const { error } = postInterventionDataSchema.validate(validPostIntervention)
    expect(error).toBeUndefined()
  })

  test('Should require status on habitat records', () => {
    const doc = structuredClone(validPostIntervention)
    delete doc.habitats[0].status
    const { error } = postInterventionDataSchema.validate(doc)
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"habitats\[0\]\.status" is required/)
  })

  test('Should reject top-level type field on habitat records', () => {
    const doc = structuredClone(validPostIntervention)
    doc.habitats[0].type = 'Grassland'
    const { error } = postInterventionDataSchema.validate(doc)
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"habitats\[0\]\.type" is not allowed/)
  })

  test('Should reject top-level condition field on habitat records', () => {
    const doc = structuredClone(validPostIntervention)
    doc.habitats[0].condition = 'Good'
    const { error } = postInterventionDataSchema.validate(doc)
    expect(error).toBeDefined()
  })

  test('Should validate a valid watercourse with encroachments in both sub-objects', () => {
    const doc = {
      ...validPostIntervention,
      habitats: [],
      watercourses: [
        {
          featureId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          ref: 'WC1',
          length: 120,
          sizeMetres: 120.5,
          units: 0.8,
          status: 'Complete',
          baseline: {
            type: 'Chalk stream',
            condition: 'Good',
            conditionScore: 3,
            distinctiveness: 'High',
            distinctivenessScore: 6,
            riparianEncroachment: 'None',
            watercourseEncroachment: 'None',
            strategicSignificance: 'Low'
          },
          proposed: {
            type: 'Modified watercourse',
            condition: 'Moderate',
            conditionScore: 2,
            distinctiveness: 'Medium',
            distinctivenessScore: 4,
            advanceYears: 0,
            delayYears: 0,
            riparianEncroachment: 'Minor',
            watercourseEncroachment: 'Minor',
            strategicSignificance: 'Medium'
          },
          properties: {}
        }
      ]
    }
    const { error } = postInterventionDataSchema.validate(doc)
    expect(error).toBeUndefined()
  })

  test('Should validate a valid hedgerow with nested sub-objects', () => {
    const doc = {
      ...validPostIntervention,
      habitats: [],
      hedgerows: [
        {
          featureId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          ref: 'HW1',
          length: 200,
          sizeMetres: 200.3,
          units: 1.2,
          status: 'Complete',
          baseline: {
            type: 'Native species-rich hedgerow',
            condition: 'Good',
            conditionScore: 3,
            distinctiveness: 'High',
            distinctivenessScore: 6
          },
          proposed: {
            type: 'Native hedge with trees - rare species',
            condition: 'Moderate',
            conditionScore: 2,
            distinctiveness: 'High',
            distinctivenessScore: 6,
            advanceYears: 1,
            delayYears: 0
          },
          properties: {}
        }
      ]
    }
    const { error } = postInterventionDataSchema.validate(doc)
    expect(error).toBeUndefined()
  })

  test('Should validate a Created individual tree carrying proposed time/difficulty multipliers', () => {
    // Regression: trees enrich via the area-habitat path, so a Created or
    // Enhanced tree gets proposed.timeMultiplier / difficultyMultiplier from the
    // engine. The tree proposed schema must allow them or persistence 500s on
    // any non-retained tree.
    const doc = {
      ...validPostIntervention,
      habitats: [],
      trees: [
        {
          featureId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          ref: 'T003',
          area: 41,
          sizeSquareMetres: 41,
          units: 0.05,
          status: 'Complete',
          count: 1,
          baseline: {
            type: 'Urban tree',
            broadType: 'Individual trees',
            condition: 'Good',
            conditionScore: 3,
            distinctiveness: 'Medium',
            distinctivenessScore: 4,
            strategicSignificance: 'Low',
            treeSize: 'Small',
            treeSpecies: 'Street tree',
            ruralOrUrban: 'Urban',
            sizeSquareMetres: 41,
            area: 41,
            retentionCategory: 'Created'
          },
          proposed: {
            type: 'Urban tree',
            broadType: 'Individual trees',
            condition: 'Good',
            conditionScore: 3,
            distinctiveness: 'Medium',
            distinctivenessScore: 4,
            strategicSignificance: 'Low',
            treeSize: 'Small',
            treeSpecies: 'Street tree',
            ruralOrUrban: 'Urban',
            sizeSquareMetres: 41,
            area: 41,
            advanceYears: 0,
            delayYears: 0,
            timeMultiplier: 0.965,
            difficultyMultiplier: 1
          },
          properties: {}
        }
      ]
    }
    const { error } = postInterventionDataSchema.validate(doc)
    expect(error).toBeUndefined()
  })

  test('projectSchema accepts postIntervention with nested structure', () => {
    const { error } = projectSchema.validate({
      name: 'Test Project',
      postIntervention: validPostIntervention
    })
    expect(error).toBeUndefined()
  })

  test('projectSchema rejects postIntervention habitat with flat type field', () => {
    const { error } = projectSchema.validate({
      name: 'Test Project',
      postIntervention: {
        ...validPostIntervention,
        habitats: [{ ...validPostIntervention.habitats[0], type: 'Grassland' }]
      }
    })
    expect(error).toBeDefined()
  })
})
