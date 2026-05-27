import { describe, test, expect } from 'vitest'
import {
  baselineSchema,
  projectSchema,
  siteSchema,
  unitsSchema
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
    const { error } = baselineSchema.validate({
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
        watercoursesTotal: 0
      }
    })
    expect(error).toBeUndefined()
  })

  test('Should reject baseline units totals with missing fields', () => {
    const { error } = baselineSchema.validate({
      importedAt: '2026-01-01T00:00:00.000Z',
      redLine: null,
      habitats: [],
      hedgerows: [],
      watercourses: [],
      units: { totalUnits: 1, habitatsTotal: 1 }
    })
    expect(error).toBeDefined()
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

describe('#baselineSchema', () => {
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
    const { error } = baselineSchema.validate(validBaseline)
    expect(error).toBeUndefined()
  })

  test('Should require status on persisted habitat documents', () => {
    const baseline = structuredClone(validBaseline)
    delete baseline.habitats[0].status

    const { error } = baselineSchema.validate(baseline)
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"habitats\[0\]\.status" is required/)
  })

  test('Should reject invalid persisted status values', () => {
    const baseline = structuredClone(validBaseline)
    baseline.watercourses[0].status = 'Done'

    const { error } = baselineSchema.validate(baseline)
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"watercourses\[0\]\.status" must be one of/)
  })

  test('Should reject the legacy misspelled watercoursEncroachment field', () => {
    const baseline = structuredClone(validBaseline)
    baseline.watercourses[0].watercoursEncroachment = 'None'
    delete baseline.watercourses[0].watercourseEncroachment

    const { error } = baselineSchema.validate(baseline)
    expect(error).toBeDefined()
    expect(error.message).toMatch(
      /"watercourses\[0\]\.watercoursEncroachment" is not allowed/
    )
  })
})
