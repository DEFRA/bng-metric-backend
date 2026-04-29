import { describe, test, expect } from 'vitest'
import { projectSchema, siteSchema, unitsSchema } from './index.js'

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
