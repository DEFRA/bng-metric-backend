import { describe, test, expect } from 'vitest'
import {
  projectSchema,
  siteSchema,
  unitsSchema,
  baselineSchema
} from './project.js'

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

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
