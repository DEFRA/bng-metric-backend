import { projectSchema, siteSchema, unitsSchema } from './index.js'

describe('validation barrel export', () => {
  test('Should export projectSchema', () => {
    expect(projectSchema).toBeDefined()
  })

  test('Should export siteSchema', () => {
    expect(siteSchema).toBeDefined()
  })

  test('Should export unitsSchema', () => {
    expect(unitsSchema).toBeDefined()
  })
})
