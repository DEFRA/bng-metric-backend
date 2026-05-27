import { describe, test, expect } from 'vitest'
import {
  baselineSchema,
  projectSchema,
  siteSchema,
  unitsSchema
} from './project.js'

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
